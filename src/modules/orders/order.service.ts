import {
  createOrderWithReservation,
  findOrderById as findOrderByIdRepo,
  listUserOrders,
  cancelOrderAndReleaseStock,
} from "./order.repository.js";
import type { CreateOrderInput, OrderQueryInput } from "./order.types.js";
import { ForbiddenError, NotFoundError } from "../../errors/AppError.js";
import { logger } from "../../common/logger.js";

/*
 * Order business rules: who may see or cancel an order, and keeping the product
 * cache in step with stock changes. Layer: routes -> validate -> controller ->
 * service -> repository. Stock and order writes live in `order.repository.ts`.
 */

/**
 * Creates an order and reserves stock for its items.
 *
 * Product caches are cleared afterwards because stock levels just changed.
 *
 * @returns The created order with items.
 * @throws {NotFoundError} 404 a product does not exist.
 * @throws {BadRequestError} 400 a product is inactive, or items mix currencies.
 * @throws {ConflictError} 409 insufficient stock or missing inventory.
 */
export async function createOrder(userId: string, input: CreateOrderInput) {
  logger.info(
    { userId, itemCount: input.items.length },
    "Order creation requested",
  );
  const order = await createOrderWithReservation(userId, input);
  await invalidateProductCaches(order.items.map((item) => item.productId));
  logger.info(
    {
      orderId: order.id,
      userId,
      itemCount: order.items.length,
      totalAmount: order.totalAmount.toString(),
      currency: order.currency,
      expiresAt: order.expiresAt,
    },
    "Order created and stock reserved",
  );
  return order;
}

/**
 * Returns one order if the caller owns it or is an ADMIN.
 *
 * @param roles Caller's roles; `ADMIN` may read any order.
 * @throws {NotFoundError} 404 order not found.
 * @throws {ForbiddenError} 403 caller is neither the owner nor an admin.
 */
export async function getOrderById(
  orderId: string,
  userId: string,
  roles: string[] = [],
) {
  const order = await findOrderByIdRepo(orderId);
  if (!order) {
    throw new NotFoundError("Order not found");
  }

  const isAdmin = roles.includes("ADMIN");
  if (!isAdmin && order.userId !== userId) {
    logger.warn(
      { orderId, userId, ownerId: order.userId },
      "Order access denied: not the owner",
    );
    throw new ForbiddenError("You do not have permission to view this order");
  }

  return order;
}

/**
 * Lists the caller's own orders, one page at a time.
 *
 * @returns `{ orders, pagination }`.
 */
export async function getUserOrders(userId: string, query: OrderQueryInput) {
  return listUserOrders(userId, query);
}

/**
 * Cancels an order and releases its reserved stock; owner or ADMIN only.
 *
 * The ownership check and the state rules run inside the repository transaction.
 * Product caches are cleared afterwards because stock levels changed.
 *
 * @param roles Caller's roles; `ADMIN` may cancel any order.
 * @returns The cancelled order with items.
 * @throws {NotFoundError} 404 order not found.
 * @throws {ForbiddenError} 403 caller is neither the owner nor an admin.
 * @throws {BadRequestError} 400 order is not pending payment.
 * @throws {ConflictError} 409 checkout already started, or the order was finalized concurrently.
 */
export async function cancelOrder(
  orderId: string,
  userId: string,
  roles: string[] = [],
) {
  const isAdmin = roles.includes("ADMIN");
  logger.info({ orderId, userId, isAdmin }, "Order cancellation requested");
  const order = await cancelOrderAndReleaseStock(orderId, userId, isAdmin);
  await invalidateProductCaches(order.items.map((item) => item.productId));
  logger.info(
    { orderId, userId, isAdmin, itemCount: order.items.length },
    "Order cancelled and reserved stock released",
  );
  return order;
}

/*
 * Drops cached product details and all cached product lists, since both show stock.
 * Runs after the DB transaction has committed. CacheService logs and swallows Redis
 * errors, so a cache outage never fails an order that is already saved.
 * The cache module is imported lazily, on first use.
 */
async function invalidateProductCaches(ids: string[]): Promise<void> {
  const { cacheService } = await import("../../common/cache/cache.service.js");
  for (const id of ids) await cacheService.del(`product:v1:${id}`);
  await cacheService.delPattern("product:list:*");
}
