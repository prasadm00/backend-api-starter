import { prisma } from "../../config/prisma.js";
import { Prisma } from "@prisma/client";
import { BadRequestError, ConflictError, NotFoundError } from "../../errors/AppError.js";

export async function createPendingPayment(params: {
  orderId: string; amount: Prisma.Decimal; currency: string; stripeSessionId: string;
}) {
  // Never reset a completed payment to pending when a duplicate Checkout request arrives.
  return prisma.payment.upsert({
    where: { stripeSessionId: params.stripeSessionId },
    create: { orderId: params.orderId, amount: params.amount, currency: params.currency,
      stripeSessionId: params.stripeSessionId, status: "PENDING" },
    update: {},
  });
}
export async function findPaymentByOrderId(orderId: string) {
  return prisma.payment.findFirst({ where: { orderId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
}

export async function finalizePaymentAndStockAtomic(params: {
  providerEventId: string; eventType: string; orderId: string; stripeSessionId: string;
  stripePaymentIntentId?: string; amountTotal: number; currency: string;
}) {
  try {
    return await prisma.$transaction(async tx => {
      // The unique event ID serializes duplicate webhook deliveries at the DB boundary.
      await tx.paymentEvent.create({
        data: { providerEventId: params.providerEventId, eventType: params.eventType, processingStatus: "SUCCESS" },
      });
      const payment = await tx.payment.findUnique({ where: { stripeSessionId: params.stripeSessionId } });
      if (!payment || payment.orderId !== params.orderId || payment.provider !== "STRIPE") {
        throw new ConflictError("Stripe session is not linked to this order");
      }
      const order = await tx.order.findUnique({ where: { id: params.orderId }, include: { items: true } });
      if (!order) throw new NotFoundError("Payment order not found");
      if (order.currency.toLowerCase() !== params.currency.toLowerCase() ||
          payment.currency.toLowerCase() !== params.currency.toLowerCase() ||
          !payment.amount.equals(order.totalAmount) ||
          !order.totalAmount.mul(100).equals(params.amountTotal)) {
        throw new ConflictError("Stripe amount or currency differs from the order");
      }
      if (order.status === "PAID") {
        // A different successful event for the same order must not sell inventory twice.
        await tx.paymentEvent.update({ where: { providerEventId: params.providerEventId }, data: { processingStatus: "SKIPPED_ALREADY_PAID" } });
        return { alreadyProcessed: true, order, payment };
      }
      if (order.status !== "PENDING_PAYMENT" || order.expiresAt <= new Date()) {
        // A paid session for a cancelled/expired order requires operator reconciliation.
        throw new ConflictError("Paid Stripe session refers to an unavailable order; reconcile payment manually");
      }
      const transitioned = await tx.order.updateMany({
        where: { id: order.id, status: "PENDING_PAYMENT", expiresAt: { gt: new Date() } },
        data: { status: "PAID" },
      });
      if (transitioned.count !== 1) throw new ConflictError("Order state changed during payment processing");
      for (const item of order.items) {
        const stock = await tx.inventory.updateMany({
          where: { productId: item.productId, reservedQuantity: { gte: item.quantity } },
          data: { reservedQuantity: { decrement: item.quantity } },
        });
        if (stock.count !== 1) throw new ConflictError("Reserved inventory mismatch");
      }
      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: { status: "COMPLETED", ...(params.stripePaymentIntentId ? { stripePaymentIntentId: params.stripePaymentIntentId } : {}) },
      });
      await tx.outboxEvent.create({
        data: { sourceId: `payment:${order.id}:confirmed`, eventType: "PAYMENT_CONFIRMED",
          payload: { orderId: order.id, paymentId: updatedPayment.id, amount: order.totalAmount.toString(), currency: order.currency } },
      });
      return { alreadyProcessed: false, order, payment: updatedPayment };
    });
  } catch (error) {
    // Transaction rolled back. Unique event insert may fail if the same event already committed.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.paymentEvent.findUnique({ where: { providerEventId: params.providerEventId } });
      if (existing) return { alreadyProcessed: true, order: null, payment: null };
    }
    throw error;
  }
}
