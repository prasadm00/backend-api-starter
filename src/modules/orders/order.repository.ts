import { prisma } from "../../config/prisma.js";
import { Prisma } from "@prisma/client";
import { ConflictError, NotFoundError, BadRequestError, ForbiddenError } from "../../errors/AppError.js";
import type { CreateOrderInput, OrderQueryInput } from "./order.types.js";

export async function createOrderWithReservation(userId: string, input: CreateOrderInput) {
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
        throw new BadRequestError(`Product "${product.name}" is currently inactive`);
      }

      if (!product.inventory) {
        throw new ConflictError(`Inventory record missing for product "${product.name}"`);
      }

      if (currency && currency !== product.currency) {
        throw new BadRequestError("Orders cannot mix product currencies");
      }
      currency = product.currency;
      // 2. Concurrency check: Ensure available stock is sufficient
      if (product.inventory.availableQuantity < item.quantity) {
        throw new ConflictError(
          `Insufficient stock for "${product.name}". Requested: ${item.quantity}, Available: ${product.inventory.availableQuantity}`,
        );
      }

      // 3. Atomically decrement available stock and increment reserved stock
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
        throw new ConflictError(`Race condition detected: Insufficient stock for "${product.name}"`);
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

    await tx.outboxEvent.create({ data: {
      sourceId: `order:${order.id}:created`, eventType: "ORDER_CREATED",
      payload: { orderId: order.id, userId: order.userId, amount: order.totalAmount.toString(), currency: order.currency },
    } });
    return order;
  });
}

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

export async function cancelOrderAndReleaseStock(orderId: string, userId?: string, isAdmin: boolean = false) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundError("Order not found");
    }

    if (!isAdmin && order.userId !== userId) {
      throw new ForbiddenError("You do not have permission to cancel this order");
    }

    if (order.status !== "PENDING_PAYMENT") {
      throw new BadRequestError(`Cannot cancel order with status ${order.status}`);
    }

    // Never release stock while a Stripe Checkout may still be payable.
    const pendingPayment = await tx.payment.findFirst({ where: { orderId, status: "PENDING" } });
    if (pendingPayment) throw new ConflictError("Checkout was initiated; complete payment or contact support");
    // Conditional state transition prevents two concurrent cancellations releasing stock twice.
    const cancelled = await tx.order.updateMany({ where: { id: orderId, status: "PENDING_PAYMENT" }, data: { status: "CANCELLED" } });
    if (cancelled.count !== 1) throw new ConflictError("Order was already finalized");
    // 1. Release reserved stock
    for (const item of order.items) {
      const updated = await tx.inventory.updateMany({
        where: { productId: item.productId, reservedQuantity: { gte: item.quantity } },
        data: { availableQuantity: { increment: item.quantity }, reservedQuantity: { decrement: item.quantity } },
      });
      if (updated.count !== 1) throw new ConflictError("Inventory reservation mismatch");
    }

    // 2. Mark order CANCELLED
    const updatedOrder = await tx.order.findUniqueOrThrow({
      where: { id: orderId }, include: { items: true },
    });

    return updatedOrder;
  });
}
