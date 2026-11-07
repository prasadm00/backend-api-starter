import { prisma } from "../../config/prisma.js";
import { Prisma } from "@prisma/client";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../../errors/AppError.js";
import { logger } from "../../common/logger.js";

/*
 * Payment data access. All database reads/writes for payments live here so the
 * service layer stays free of Prisma details.
 */

/**
 * Records a PENDING payment for a newly created Stripe Checkout session.
 * Safe to call more than once for the same session (see comment below).
 */
export async function createPendingPayment(params: {
  orderId: string;
  amount: Prisma.Decimal;
  currency: string;
  stripeSessionId: string;
}) {
  // Never reset a completed payment to pending when a duplicate Checkout request arrives.
  return prisma.payment.upsert({
    where: { stripeSessionId: params.stripeSessionId },
    create: {
      orderId: params.orderId,
      amount: params.amount,
      currency: params.currency,
      stripeSessionId: params.stripeSessionId,
      status: "PENDING",
    },
    update: {},
  });
}
/**
 * Returns the most recent payment for an order, or `null`.
 * The secondary sort on `id` makes the result deterministic when two rows share a timestamp.
 */
export async function findPaymentByOrderId(orderId: string) {
  return prisma.payment.findFirst({
    where: { orderId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

/**
 * Applies a paid Stripe Checkout session to our database, all or nothing.
 *
 * In a single transaction it: records the event (idempotency), validates the
 * session/amount/currency, marks the order PAID, converts reserved stock into a
 * sale, marks the payment COMPLETED, and queues a PAYMENT_CONFIRMED outbox event.
 * If any step throws, every change is rolled back.
 *
 * @returns `alreadyProcessed: true` for duplicate deliveries or already-paid
 *          orders (no stock is touched), otherwise the updated order and payment.
 * @throws {ConflictError} 409 on amount/currency mismatch, unlinked session,
 *         unavailable (cancelled/expired) order, or a concurrent state change.
 */
export async function finalizePaymentAndStockAtomic(params: {
  providerEventId: string;
  eventType: string;
  orderId: string;
  stripeSessionId: string;
  stripePaymentIntentId?: string;
  amountTotal: number;
  currency: string;
}) {
  try {
    return await prisma.$transaction(async (tx) => {
      // Step 1 - Idempotency guard. `providerEventId` is unique, so if Stripe
      // delivers the same event twice, the second insert fails with P2002 and the
      // whole transaction rolls back (handled in the catch block below).
      await tx.paymentEvent.create({
        data: {
          providerEventId: params.providerEventId,
          eventType: params.eventType,
          processingStatus: "SUCCESS",
        },
      });
      // Step 2 - The session must belong to a Payment we created for this order.
      const payment = await tx.payment.findUnique({
        where: { stripeSessionId: params.stripeSessionId },
      });
      if (
        !payment ||
        payment.orderId !== params.orderId ||
        payment.provider !== "STRIPE"
      ) {
        logger.error(
          {
            eventId: params.providerEventId,
            orderId: params.orderId,
            sessionId: params.stripeSessionId,
            paymentFound: Boolean(payment),
          },
          "Payment finalize rejected: Stripe session is not linked to this order",
        );
        throw new ConflictError("Stripe session is not linked to this order");
      }
      const order = await tx.order.findUnique({
        where: { id: params.orderId },
        include: { items: true },
      });
      if (!order) throw new NotFoundError("Payment order not found");
      // Step 3 - Money check. Currencies must all agree, and the amount Stripe
      // charged (in cents) must equal our stored total. Decimal math (`mul`,
      // `equals`) avoids floating-point rounding errors.
      if (
        order.currency.toLowerCase() !== params.currency.toLowerCase() ||
        payment.currency.toLowerCase() !== params.currency.toLowerCase() ||
        !payment.amount.equals(order.totalAmount) ||
        !order.totalAmount.mul(100).equals(params.amountTotal)
      ) {
        logger.error(
          {
            eventId: params.providerEventId,
            orderId: params.orderId,
            orderAmount: order.totalAmount.toString(),
            orderCurrency: order.currency,
            stripeAmountMinorUnits: params.amountTotal,
            stripeCurrency: params.currency,
          },
          "Payment finalize rejected: Stripe amount or currency differs from the order",
        );
        throw new ConflictError(
          "Stripe amount or currency differs from the order",
        );
      }
      // Step 4 - Order state checks.
      if (order.status === "PAID") {
        logger.info(
          { eventId: params.providerEventId, orderId: params.orderId },
          "Payment finalize skipped: order is already PAID (stock not touched again)",
        );
        // A different successful event for the same order must not sell inventory twice.
        await tx.paymentEvent.update({
          where: { providerEventId: params.providerEventId },
          data: { processingStatus: "SKIPPED_ALREADY_PAID" },
        });
        return { alreadyProcessed: true, order, payment };
      }
      if (order.status !== "PENDING_PAYMENT" || order.expiresAt <= new Date()) {
        logger.error(
          {
            eventId: params.providerEventId,
            orderId: params.orderId,
            orderStatus: order.status,
            expiresAt: order.expiresAt,
            sessionId: params.stripeSessionId,
          },
          "Customer paid but order is cancelled/expired: manual reconciliation (refund) required",
        );
        // A paid session for a cancelled/expired order requires operator reconciliation.
        throw new ConflictError(
          "Paid Stripe session refers to an unavailable order; reconcile payment manually",
        );
      }
      // Step 5 - Mark the order PAID with a conditional update (optimistic lock).
      // The WHERE re-checks status and expiry, so if a concurrent cancel/expiry
      // won the race, 0 rows change and we abort instead of overwriting it.
      const transitioned = await tx.order.updateMany({
        where: {
          id: order.id,
          status: "PENDING_PAYMENT",
          expiresAt: { gt: new Date() },
        },
        data: { status: "PAID" },
      });
      if (transitioned.count !== 1)
        throw new ConflictError(
          "Order state changed during payment processing",
        );
      // Step 6 - Turn reserved stock into sold stock. `availableQuantity` was
      // already reduced when the order was created; here we only release the
      // reservation. The `gte` guard stops the counter from going negative.
      for (const item of order.items) {
        const stock = await tx.inventory.updateMany({
          where: {
            productId: item.productId,
            reservedQuantity: { gte: item.quantity },
          },
          data: { reservedQuantity: { decrement: item.quantity } },
        });
        if (stock.count !== 1)
          throw new ConflictError("Reserved inventory mismatch");
      }
      // Step 7 - Record the payment as completed.
      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "COMPLETED",
          ...(params.stripePaymentIntentId
            ? { stripePaymentIntentId: params.stripePaymentIntentId }
            : {}),
        },
      });
      // Step 8 - Transactional outbox. The confirmation event is written in the
      // same transaction, so it exists if and only if the payment committed. A
      // background worker later reads it and sends the email. `sourceId` is
      // deterministic so the event can't be queued twice for one order.
      await tx.outboxEvent.create({
        data: {
          sourceId: `payment:${order.id}:confirmed`,
          eventType: "PAYMENT_CONFIRMED",
          payload: {
            orderId: order.id,
            paymentId: updatedPayment.id,
            amount: order.totalAmount.toString(),
            currency: order.currency,
          },
        },
      });
      return { alreadyProcessed: false, order, payment: updatedPayment };
    });
  } catch (error) {
    // Transaction rolled back. Unique event insert may fail if the same event already committed.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await prisma.paymentEvent.findUnique({
        where: { providerEventId: params.providerEventId },
      });
      if (existing) {
        logger.info(
          {
            eventId: params.providerEventId,
            orderId: params.orderId,
            previousStatus: existing.processingStatus,
          },
          "Duplicate Stripe event delivery detected (event id already recorded)",
        );
        return { alreadyProcessed: true, order: null, payment: null };
      }
    }
    throw error;
  }
}
