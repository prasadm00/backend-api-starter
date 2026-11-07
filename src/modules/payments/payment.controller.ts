/**
 * Payment controllers.
 *
 * Controllers are deliberately thin: read input from the HTTP request, call the
 * service, shape the HTTP response. All business rules live in
 * `payment.service.ts`. Errors are not caught here; thrown `AppError`s are
 * turned into JSON responses by the global error handler in `app.ts`.
 */
import type { Request, Response } from "express";
import {
  initiateCheckout,
  getPaymentStatus,
  processStripeWebhook,
} from "./payment.service.js";
import { logger } from "../../common/logger.js";

/**
 * POST /orders/:id/checkout
 *
 * Starts (or resumes) a Stripe Checkout session for one of the caller's orders
 * and returns the URL the frontend should redirect the customer to.
 */
export async function checkoutHandler(req: Request, res: Response) {
  // `authenticate` has already run, so `req.user` is populated.
  // `sub` is a fallback for tokens that use the standard JWT subject claim.
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

/**
 * GET /orders/:id/payment
 *
 * Returns the server-side order and payment status. This is the value the
 * frontend should trust, not the Stripe success redirect.
 */
export async function getPaymentStatusHandler(req: Request, res: Response) {
  const user = req.user as any;
  const userId = user?.userId || user?.sub;
  // Roles come from the database (refreshed by `authenticate`); ADMIN may view any order.
  const roles = (user?.roles as string[]) || [];
  const orderId = req.params.id as string;

  const status = await getPaymentStatus(orderId, userId, roles);

  return res.status(200).json({
    status: "success",
    data: status,
  });
}

/**
 * POST /webhooks/stripe
 *
 * Receives events from Stripe. `req.body` is a raw `Buffer` here (not parsed
 * JSON) because the signature is computed over the exact bytes Stripe sent.
 *
 * Responding 2xx tells Stripe "received, don't retry". Any thrown error becomes
 * a 4xx/5xx and Stripe will retry delivery later, which is safe because
 * processing is idempotent on the Stripe event id.
 */
export async function stripeWebhookHandler(req: Request, res: Response) {
  const signature = req.headers["stripe-signature"];
  // First sign that Stripe (or `stripe listen`) actually reached this server.
  logger.info(
    {
      requestId: req.requestId,
      hasSignature: typeof signature === "string" && signature.length > 0,
      bodyIsRawBuffer: Buffer.isBuffer(req.body),
      bodyBytes: Buffer.isBuffer(req.body) ? req.body.length : undefined,
    },
    "Stripe webhook request received",
  );
  // Headers can be string | string[] | undefined; pass "" so the service rejects it as unsigned.
  const result = await processStripeWebhook(
    req.body,
    typeof signature === "string" ? signature : "",
  );

  return res.status(200).json({
    received: true,
    result,
  });
}
