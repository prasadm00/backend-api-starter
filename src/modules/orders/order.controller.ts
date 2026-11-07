import type { Request, Response } from "express";
import {
  createOrder,
  getOrderById,
  getUserOrders,
  cancelOrder,
} from "./order.service.js";
import type { CreateOrderInput, OrderQueryInput } from "./order.types.js";

/*
 * Order controllers.
 *
 * Thin HTTP layer (routes -> validate -> controller -> service -> repository): read
 * the request, call the service, shape the response. Business rules live in
 * `order.service.ts`. Errors are not caught here; the global error handler turns
 * thrown `AppError`s into JSON responses.
 */

/**
 * POST /orders
 *
 * Creates an order from the validated body and reserves stock. Responds 201.
 */
export async function createOrderHandler(req: Request, res: Response) {
  const user = req.user as any;
  const userId = user?.userId || user?.sub;
  const input = req.body as CreateOrderInput;

  const order = await createOrder(userId, input);

  return res.status(201).json({
    status: "success",
    message: "Order created and stock reserved successfully",
    data: order,
  });
}

/**
 * GET /orders/:id
 *
 * Returns one order. Roles are passed on so the service can allow ADMIN to read any order.
 */
export async function getOrderHandler(req: Request, res: Response) {
  const user = req.user as any;
  const userId = user?.userId || user?.sub;
  const roles = (user?.roles as string[]) || [];
  const orderId = req.params.id as string;

  const order = await getOrderById(orderId, userId, roles);

  return res.status(200).json({
    status: "success",
    data: order,
  });
}

/**
 * GET /orders
 *
 * Lists the caller's own orders with pagination. Reads `req.validatedQuery`, which
 * `validateOrderQuery` filled with coerced, defaulted values.
 */
export async function listOrdersHandler(req: Request, res: Response) {
  const user = req.user as any;
  const userId = user?.userId || user?.sub;
  const query = req.validatedQuery as OrderQueryInput;

  const result = await getUserOrders(userId, query);

  return res.status(200).json({
    status: "success",
    data: result.orders,
    pagination: result.pagination,
  });
}

/**
 * POST /orders/:id/cancel
 *
 * Cancels an order and releases its reserved stock. Owner or ADMIN only (enforced downstream).
 */
export async function cancelOrderHandler(req: Request, res: Response) {
  const user = req.user as any;
  const userId = user?.userId || user?.sub;
  const roles = (user?.roles as string[]) || [];
  const orderId = req.params.id as string;

  const order = await cancelOrder(orderId, userId, roles);

  return res.status(200).json({
    status: "success",
    message: "Order cancelled and reserved stock released",
    data: order,
  });
}
