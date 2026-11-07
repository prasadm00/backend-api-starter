import { findOrderById } from "../orders/order.repository.js";
import {
  createPendingPayment,
  findPaymentByOrderId,
  finalizePaymentAndStockAtomic,
} from "./payment.repository.js";
import {
  createStripeCheckoutSession,
  constructStripeEvent,
  retrieveCheckoutSession,
} from "./stripe.service.js";
import {
  ForbiddenError,
  NotFoundError,
  BadRequestError,
  ConflictError,
} from "../../errors/AppError.js";
import { logger } from "../../common/logger.js";

/*
 * Payment business rules: who may pay, when, and how a Stripe event becomes a
 * PAID order. HTTP concerns live in the controller, database work in the
 * repository, and Stripe API calls in `stripe.service.ts`.
 */

/** Stripe requires a Checkout session to live at least 30 minutes; +1 minute is a safety buffer. */
const MIN_RESERVATION_MINUTES_FOR_CHECKOUT = 31;

/**
 * Starts payment for an order by creating (or reusing) a Stripe Checkout session.
 *
 * Checks, in order: the order exists, belongs to the caller, is still
 * PENDING_PAYMENT, and has enough reservation time left for a Stripe session.
 * If an open session already exists it is reused, so double-clicks or retries
 * never create a second session.
 *
 * @returns The Stripe-hosted `checkoutUrl` to redirect the customer to, and the `sessionId`.
 * @throws {NotFoundError} 404 order not found.
 * @throws {ForbiddenError} 403 order belongs to another user.
 * @throws {BadRequestError} 400 order is not pending payment.
 * @throws {ConflictError} 409 not enough reservation time, or the existing session expired.
 */
export async function initiateCheckout(
  orderId: string,
  userId: string,
  userEmail: string,
) {
  logger.info({ orderId, userId }, "Checkout requested");

  const order = await findOrderById(orderId);
  if (!order) {
    logger.warn({ orderId, userId }, "Checkout rejected: order not found");
    throw new NotFoundError("Order not found");
  }
  if (order.userId !== userId) {
    logger.warn(
      { orderId, userId, ownerId: order.userId },
      "Checkout rejected: order belongs to another user",
    );
    throw new ForbiddenError("Cannot checkout another user's order");
  }
  if (order.status !== "PENDING_PAYMENT") {
    logger.warn(
      { orderId, userId, orderStatus: order.status },
      "Checkout rejected: order is not pending payment",
    );
    throw new BadRequestError("Order is not pending payment");
  }
  // Reservation must outlive the Stripe session, otherwise a customer could pay
  // for stock that has already been released back to other buyers.
  if (
    order.expiresAt.getTime() <=
    Date.now() + MIN_RESERVATION_MINUTES_FOR_CHECKOUT * 60_000
  ) {
    logger.warn(
      {
        orderId,
        userId,
        expiresAt: order.expiresAt,
        minutesLeft: Math.floor(
          (order.expiresAt.getTime() - Date.now()) / 60_000,
        ),
        requiredMinutes: MIN_RESERVATION_MINUTES_FOR_CHECKOUT,
      },
      "Checkout rejected: not enough reservation time left",
    );
    throw new ConflictError(
      "Not enough reservation time remains for Checkout; create a new order",
    );
  }

  const current = await findPaymentByOrderId(order.id);
  if (current?.stripeSessionId && current.status === "PENDING") {
    const session = await retrieveCheckoutSession(current.stripeSessionId);
    if (session.status === "open" && session.url) {
      logger.info(
        { orderId, userId, sessionId: session.id },
        "Reusing existing open Stripe Checkout session",
      );
      return { checkoutUrl: session.url, sessionId: session.id };
    }
    // An expired Checkout session must not be silently replaced in the same reservation.
    logger.warn(
      {
        orderId,
        userId,
        sessionId: current.stripeSessionId,
        sessionStatus: session.status,
      },
      "Checkout rejected: existing Stripe session is no longer open",
    );
    throw new ConflictError(
      "Checkout session is no longer open; cancel the order and create a new one",
    );
  }
  const session = await createStripeCheckoutSession({
    orderId: order.id,
    userId,
    userEmail,
    currency: order.currency,
    expiresAt: order.expiresAt,
    items: order.items.map((item) => ({
      name: item.product.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toNumber(),
    })),
  });
  await createPendingPayment({
    orderId: order.id,
    amount: order.totalAmount,
    currency: order.currency,
    stripeSessionId: session.sessionId,
  });
  logger.info(
    {
      orderId,
      userId,
      sessionId: session.sessionId,
      amount: order.totalAmount.toString(),
      currency: order.currency,
    },
    "Pending payment recorded; awaiting Stripe webhook",
  );
  return { checkoutUrl: session.sessionUrl, sessionId: session.sessionId };
}

/**
 * Returns the trusted, server-side status of an order and its latest payment.
 *
 * @param roles Caller's roles; `ADMIN` may read any order, others only their own.
 * @returns `paymentStatus: "NONE"` when checkout has never been started.
 * @throws {NotFoundError} 404 when the order doesn't exist.
 * @throws {ForbiddenError} 403 when the caller is neither the owner nor an admin.
 */
export async function getPaymentStatus(
  orderId: string,
  userId: string,
  roles: string[] = [],
) {
  const order = await findOrderById(orderId);
  if (!order) {
    logger.warn(
      { orderId, userId },
      "Payment status rejected: order not found",
    );
    throw new NotFoundError("Order not found");
  }
  if (order.userId !== userId && !roles.includes("ADMIN")) {
    logger.warn(
      { orderId, userId, ownerId: order.userId },
      "Payment status rejected: not the owner and not an admin",
    );
    throw new ForbiddenError("Cannot view another user's payment");
  }
  const payment = await findPaymentByOrderId(orderId);
  logger.debug(
    {
      orderId,
      userId,
      orderStatus: order.status,
      paymentStatus: payment?.status ?? "NONE",
    },
    "Payment status read",
  );
  return {
    orderId: order.id,
    orderStatus: order.status,
    totalAmount: order.totalAmount.toString(),
    currency: order.currency,
    paymentStatus: payment?.status ?? "NONE",
    paymentDetails: payment
      ? { id: payment.id, status: payment.status, createdAt: payment.createdAt }
      : null,
  };
}

/**
 * Handles one Stripe webhook delivery.
 *
 * Only `checkout.session.completed` with `payment_status === "paid"` changes
 * data; every other event is acknowledged and ignored so Stripe stops retrying.
 * The actual database changes happen atomically in
 * `finalizePaymentAndStockAtomic`.
 *
 * @returns A small result object echoed back to Stripe (useful in the Stripe dashboard / CLI).
 * @throws {UnauthorizedError} 401 on a missing/invalid signature.
 * @throws {BadRequestError} 400 when the session lacks matching order/amount fields.
 * @throws {ConflictError} 409 when the payment can't be applied (needs reconciliation).
 */
export async function processStripeWebhook(rawBody: Buffer, signature: string) {
  const event = constructStripeEvent(rawBody, signature);
  logger.info(
    { eventId: event.id, eventType: event.type },
    "Verified Stripe event",
  );
  if (event.type !== "checkout.session.completed") {
    logger.debug(
      { eventId: event.id, eventType: event.type },
      "Stripe event ignored: type is not handled",
    );
    return { processed: true, ignoredType: event.type };
  }
  const session = event.data.object;
  if (session.object !== "checkout.session") {
    logger.warn(
      { eventId: event.id, objectType: session.object },
      "Stripe event rejected: unexpected object type",
    );
    throw new BadRequestError("Unexpected Stripe event object");
  }
  // For card-only Checkout, payment_status MUST be paid before confirming inventory.
  if (session.payment_status !== "paid") {
    logger.info(
      {
        eventId: event.id,
        sessionId: session.id,
        paymentStatus: session.payment_status,
      },
      "Stripe session completed but not paid yet; nothing changed",
    );
    return { processed: true, awaitingPayment: true };
  }
  const orderId = session.metadata?.orderId;
  if (
    !orderId ||
    orderId !== session.client_reference_id ||
    !session.amount_total ||
    !session.currency
  ) {
    logger.warn(
      {
        eventId: event.id,
        sessionId: session.id,
        hasOrderId: Boolean(orderId),
        orderIdMatchesReference: orderId === session.client_reference_id,
        hasAmount: Boolean(session.amount_total),
        hasCurrency: Boolean(session.currency),
      },
      "Stripe event rejected: session missing matching order or payment fields",
    );
    throw new BadRequestError(
      "Checkout session missing matching order or payment fields",
    );
  }

  logger.info(
    {
      eventId: event.id,
      orderId,
      sessionId: session.id,
      amountTotal: session.amount_total,
      currency: session.currency,
    },
    "Finalizing paid Checkout session",
  );

  let result;
  try {
    result = await finalizePaymentAndStockAtomic({
      providerEventId: event.id,
      eventType: event.type,
      orderId,
      stripeSessionId: session.id,
      ...(typeof session.payment_intent === "string"
        ? { stripePaymentIntentId: session.payment_intent }
        : {}),
      amountTotal: session.amount_total,
      currency: session.currency,
    });
  } catch (error) {
    // Money was taken but the order could not be updated: surface loudly for reconciliation.
    logger.error(
      {
        err: error,
        eventId: event.id,
        orderId,
        sessionId: session.id,
        amountTotal: session.amount_total,
        currency: session.currency,
      },
      "Failed to apply paid Stripe session; transaction rolled back, manual reconciliation may be required",
    );
    throw error;
  }

  if (result.alreadyProcessed) {
    logger.info(
      { eventId: event.id, orderId },
      "Stripe event already processed; duplicate delivery ignored",
    );
  } else {
    logger.info(
      {
        eventId: event.id,
        orderId,
        sessionId: session.id,
        paymentId: result.payment?.id,
      },
      "Payment confirmed: order marked PAID, stock converted to sale, confirmation queued",
    );
  }
  // Confirmation email is committed to the transactional outbox with the payment.
  return { processed: true, duplicate: result.alreadyProcessed };
}
