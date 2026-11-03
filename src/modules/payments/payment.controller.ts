import type { Request, Response } from "express";
import {
  initiateCheckout,
  getPaymentStatus,
  processStripeWebhook,
} from "./payment.service.js";

export async function checkoutHandler(req: Request, res: Response) {
  const user = req.user as any;
  const userId = user?.userId || user?.sub;
  const userEmail = user.email;
  const orderId = req.params.id as string;

  const result = await initiateCheckout(orderId, userId, userEmail);

  return res.status(200).json({
    status: "success",
    message: "Stripe checkout session initialized",
    data: result,
  });
}

export async function getPaymentStatusHandler(req: Request, res: Response) {
  const user = req.user as any;
  const userId = user?.userId || user?.sub;
  const roles = (user?.roles as string[]) || [];
  const orderId = req.params.id as string;

  const status = await getPaymentStatus(orderId, userId, roles);

  return res.status(200).json({
    status: "success",
    data: status,
  });
}

export async function stripeWebhookHandler(req: Request, res: Response) {
  const signature = req.headers["stripe-signature"];
  const result = await processStripeWebhook(req.body, typeof signature === "string" ? signature : "");

  return res.status(200).json({
    received: true,
    result,
  });
}
