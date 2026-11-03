import { findOrderById } from "../orders/order.repository.js";
import { createPendingPayment, findPaymentByOrderId, finalizePaymentAndStockAtomic } from "./payment.repository.js";
import { createStripeCheckoutSession, constructStripeEvent, retrieveCheckoutSession } from "./stripe.service.js";
import { ForbiddenError, NotFoundError, BadRequestError, ConflictError } from "../../errors/AppError.js";
import { logger } from "../../common/logger.js";

export async function initiateCheckout(orderId: string, userId: string, userEmail: string) {
  const order = await findOrderById(orderId);
  if (!order) throw new NotFoundError("Order not found");
  if (order.userId !== userId) throw new ForbiddenError("Cannot checkout another user's order");
  if (order.status !== "PENDING_PAYMENT") throw new BadRequestError("Order is not pending payment");
  if (order.expiresAt.getTime() <= Date.now() + 31 * 60_000) {
    throw new ConflictError("Not enough reservation time remains for Checkout; create a new order");
  }

  const current = await findPaymentByOrderId(order.id);
  if (current?.stripeSessionId && current.status === "PENDING") {
    const session = await retrieveCheckoutSession(current.stripeSessionId);
    if (session.status === "open" && session.url) return { checkoutUrl: session.url, sessionId: session.id };
    // An expired Checkout session must not be silently replaced in the same reservation.
    throw new ConflictError("Checkout session is no longer open; cancel the order and create a new one");
  }
  const session = await createStripeCheckoutSession({
    orderId: order.id, userId, userEmail,
    currency: order.currency, expiresAt: order.expiresAt,
    items: order.items.map(item => ({ name: item.product.name, quantity: item.quantity,
      unitPrice: item.unitPrice.toNumber() })),
  });
  await createPendingPayment({ orderId: order.id, amount: order.totalAmount,
    currency: order.currency, stripeSessionId: session.sessionId });
  return { checkoutUrl: session.sessionUrl, sessionId: session.sessionId };
}

export async function getPaymentStatus(orderId: string, userId: string, roles: string[] = []) {
  const order = await findOrderById(orderId);
  if (!order) throw new NotFoundError("Order not found");
  if (order.userId !== userId && !roles.includes("ADMIN")) throw new ForbiddenError("Cannot view another user's payment");
  const payment = await findPaymentByOrderId(orderId);
  return { orderId: order.id, orderStatus: order.status,
    totalAmount: order.totalAmount.toString(), currency: order.currency,
    paymentStatus: payment?.status ?? "NONE",
    paymentDetails: payment ? { id: payment.id, status: payment.status, createdAt: payment.createdAt } : null };
}

export async function processStripeWebhook(rawBody: Buffer, signature: string) {
  const event = constructStripeEvent(rawBody, signature);
  logger.info({ eventId: event.id, eventType: event.type }, "Verified Stripe event");
  if (event.type !== "checkout.session.completed") return { processed: true, ignoredType: event.type };
  const session = event.data.object;
  if (session.object !== "checkout.session") throw new BadRequestError("Unexpected Stripe event object");
  // For card-only Checkout, payment_status MUST be paid before confirming inventory.
  if (session.payment_status !== "paid") return { processed: true, awaitingPayment: true };
  const orderId = session.metadata?.orderId;
  if (!orderId || orderId !== session.client_reference_id || !session.amount_total || !session.currency) {
    throw new BadRequestError("Checkout session missing matching order or payment fields");
  }
  const result = await finalizePaymentAndStockAtomic({
    providerEventId: event.id, eventType: event.type,
    orderId, stripeSessionId: session.id,
    ...(typeof session.payment_intent === "string" ? { stripePaymentIntentId: session.payment_intent } : {}),
    amountTotal: session.amount_total, currency: session.currency,
  });
  // Confirmation email is committed to the transactional outbox with the payment.
  return { processed: true, duplicate: result.alreadyProcessed };
}
