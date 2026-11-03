import { Router } from "express";
import { authenticate } from "../../middlewares/auth.js";
import {
  checkoutHandler,
  getPaymentStatusHandler,
  stripeWebhookHandler,
} from "./payment.controller.js";

const router = Router();

// Order Checkout & Payment status (authenticated)
router.post("/orders/:id/checkout", authenticate, checkoutHandler);
router.get("/orders/:id/payment", authenticate, getPaymentStatusHandler);

// Public Stripe Webhook Endpoint (uses raw body parser)
router.post(
  "/webhooks/stripe",
  stripeWebhookHandler,
);

export default router;
