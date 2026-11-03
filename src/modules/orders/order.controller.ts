import type { Request, Response } from "express";
import {
  createOrder,
  getOrderById,
  getUserOrders,
  cancelOrder,
} from "./order.service.js";
import type { CreateOrderInput, OrderQueryInput } from "./order.types.js";

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
