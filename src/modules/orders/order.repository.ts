import { prisma } from "../../config/prisma.js";
import { Prisma } from "@prisma/client";
import {
  ConflictError,
  NotFoundError,
  BadRequestError,
  ForbiddenError,
} from "../../errors/AppError.js";
import type { CreateOrderInput, OrderQueryInput } from "./order.types.js";

/*
 * Order repository (database layer).
 *
 * Flow: routes -> validate -> controller -> service -> repository.
 * Owns all Prisma access for orders, including the two stock-moving
 * transactions: reserving stock on create and releasing it on cancel.
 */

/**
 * Creates a PENDING_PAYMENT order and reserves stock for every item, atomically.
 *
 * Everything runs in one transaction: if any item fails, the stock moves and
 * the order are all rolled back. Stock moves from `availableQuantity` to
 * `reservedQuantity` here; it only becomes a sale when payment is confirmed.
 * An `ORDER_CREATED` outbox event is written in the same transaction.
 *
 * @returns The new order with its items and basic product info.
 * @throws {NotFoundError} 404 a product does not exist.
 * @throws {BadRequestError} 400 a product is inactive, or items mix currencies.
 * @throws {ConflictError} 409 inventory is missing, or stock is insufficient (including races).
 */
export async function createOrderWithReservation(
  userId: string,
  input: CreateOrderInput,
) {
  // Stock is reserved for 60 minutes; checkout requires enough of this window to remain.
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 60-minute reservation

  return prisma.$transaction(async (tx) => {
    let totalAmount = new Prisma.Decimal(0);
    let currency: string | undefined;
    const orderItemsData: {
      productId: string;
      quantity: number;
      unitPrice: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
    }[] = [];

    for (const item of input.items) {
      // 1. Fetch product and inventory
      const product = await tx.product.findUnique({
        where: { id: item.productId },
        include: { inventory: true },
      });

      if (!product) {
        throw new NotFoundError(`Product ${item.productId} not found`);
      }

      if (product.status !== "ACTIVE") {
        throw new BadRequestError(
          `Product "${product.name}" is currently inactive`,
        );
      }

      if (!product.inventory) {
        throw new ConflictError(
          `Inventory record missing for product "${product.name}"`,
        );
      }

      if (currency && currency !== product.currency) {
        throw new BadRequestError("Orders cannot mix product currencies");
      }
      currency = product.currency;
      // 2. Concurrency check: Ensure available stock is sufficient
      // This read is only a fast, friendly failure; the conditional update below is the real guard.
      if (product.inventory.availableQuantity < item.quantity) {
        throw new ConflictError(
          `Insufficient stock for "${product.name}". Requested: ${item.quantity}, Available: ${product.inventory.availableQuantity}`,
        );
      }

      // 3. Atomically decrement available stock and increment reserved stock
      // The `gte` condition makes the update match zero rows if another order took the stock
      // after our read above, so concurrent buyers can never oversell.
      const updatedInventory = await tx.inventory.updateMany({
        where: {
          productId: item.productId,
          availableQuantity: { gte: item.quantity }, // Optimistic lock / conditional update
        },
        data: {
          availableQuantity: { decrement: item.quantity },
          reservedQuantity: { increment: item.quantity },
        },
      });

      if (updatedInventory.count === 0) {
        throw new ConflictError(
          `Race condition detected: Insufficient stock for "${product.name}"`,
        );
      }

      // 4. Calculate prices from database snapshot (never client input)
      const unitPrice = product.price;
      const lineTotal = unitPrice.mul(new Prisma.Decimal(item.quantity));
      totalAmount = totalAmount.add(lineTotal);

      orderItemsData.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice,
        lineTotal,
      });
    }

    // 5. Create Order and items
    const order = await tx.order.create({
      data: {
        userId,
        status: "PENDING_PAYMENT",
        totalAmount,
        currency: currency ?? "USD",
        expiresAt,
        items: {
          create: orderItemsData,
        },
      },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                price: true,
              },
            },
          },
        },
      },
    });

    // Written in the same transaction as the order, so the event exists if and only if
    // the order does (transactional outbox pattern).
    await tx.outboxEvent.create({
      data: {
        sourceId: `order:${order.id}:created`,
        eventType: "ORDER_CREATED",
        payload: {
          orderId: order.id,
          userId: order.userId,
          amount: order.totalAmount.toString(),
          currency: order.currency,
        },
      },
    });
    return order;
  });
}

/**
 * Loads one order with its items, product basics and all payments.
 *
 * Does no ownership check; callers (service layer) enforce owner-or-ADMIN access.
 *
 * @returns The order, or `null` when it doesn't exist.
 */
export async function findOrderById(id: string) {
  return prisma.order.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              price: true,
            },
          },
        },
      },
      payments: true,
    },
  });
}

/**
 * Returns one page of the caller's own orders, newest first, plus pagination metadata.
 *
 * @returns `{ orders, pagination }`; `totalPages` is at least 1 even with no orders.
 */
export async function listUserOrders(userId: string, query: OrderQueryInput) {
  const { page, limit, status } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.OrderWhereInput = {
    userId,
    ...(status ? { status } : {}),
  };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip,
      take: limit,
      // `id` is a tie-breaker so orders with equal createdAt keep a stable order across pages.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true },
            },
          },
        },
      },
    }),
    prisma.order.count({ where }),
  ]);

  return {
    orders,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * Cancels a PENDING_PAYMENT order and returns its reserved stock to available, atomically.
 *
 * @param userId Caller's id; must own the order unless `isAdmin` is true.
 * @returns The order (with items) after cancellation.
 * @throws {NotFoundError} 404 order not found.
 * @throws {ForbiddenError} 403 caller is neither the owner nor an admin.
 * @throws {BadRequestError} 400 order is not PENDING_PAYMENT.
 * @throws {ConflictError} 409 a Stripe payment is PENDING, the order was finalized
 *   concurrently, or the inventory reservation doesn't match.
 */
export async function cancelOrderAndReleaseStock(
  orderId: string,
  userId?: string,
  isAdmin: boolean = false,
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundError("Order not found");
    }

    if (!isAdmin && order.userId !== userId) {
      throw new ForbiddenError(
        "You do not have permission to cancel this order",
      );
    }

    if (order.status !== "PENDING_PAYMENT") {
      throw new BadRequestError(
        `Cannot cancel order with status ${order.status}`,
      );
    }

    // Never release stock while a Stripe Checkout may still be payable.
    const pendingPayment = await tx.payment.findFirst({
      where: { orderId, status: "PENDING" },
    });
    if (pendingPayment)
      throw new ConflictError(
        "Checkout was initiated; complete payment or contact support",
      );
    // Conditional state transition prevents two concurrent cancellations releasing stock twice.
    const cancelled = await tx.order.updateMany({
      where: { id: orderId, status: "PENDING_PAYMENT" },
      data: { status: "CANCELLED" },
    });
    if (cancelled.count !== 1)
      throw new ConflictError("Order was already finalized");
    // 1. Release reserved stock
    for (const item of order.items) {
      const updated = await tx.inventory.updateMany({
        where: {
          productId: item.productId,
          reservedQuantity: { gte: item.quantity },
        },
        data: {
          availableQuantity: { increment: item.quantity },
          reservedQuantity: { decrement: item.quantity },
        },
      });
      if (updated.count !== 1)
        throw new ConflictError("Inventory reservation mismatch");
    }

    // 2. Mark order CANCELLED
    const updatedOrder = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });

    return updatedOrder;
  });
}
