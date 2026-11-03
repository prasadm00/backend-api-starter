import {
  createOrderWithReservation,
  findOrderById as findOrderByIdRepo,
  listUserOrders,
  cancelOrderAndReleaseStock,
} from "./order.repository.js";
import type { CreateOrderInput, OrderQueryInput } from "./order.types.js";
import { ForbiddenError, NotFoundError } from "../../errors/AppError.js";

export async function createOrder(userId: string, input: CreateOrderInput) {
  const order = await createOrderWithReservation(userId, input);
  await invalidateProductCaches(order.items.map(item => item.productId));
  return order;
}

export async function getOrderById(orderId: string, userId: string, roles: string[] = []) {
  const order = await findOrderByIdRepo(orderId);
  if (!order) {
    throw new NotFoundError("Order not found");
  }

  const isAdmin = roles.includes("ADMIN");
  if (!isAdmin && order.userId !== userId) {
    throw new ForbiddenError("You do not have permission to view this order");
  }

  return order;
}

export async function getUserOrders(userId: string, query: OrderQueryInput) {
  return listUserOrders(userId, query);
}

export async function cancelOrder(orderId: string, userId: string, roles: string[] = []) {
  const isAdmin = roles.includes("ADMIN");
  const order = await cancelOrderAndReleaseStock(orderId, userId, isAdmin);
  await invalidateProductCaches(order.items.map(item => item.productId));
  return order;
}
async function invalidateProductCaches(ids: string[]): Promise<void> {
  const { cacheService } = await import("../../common/cache/cache.service.js");
  for (const id of ids) await cacheService.del(`product:v1:${id}`);
  await cacheService.delPattern("product:list:*");
}
