/**
 * Payment routes.
 *
 * Mounted at both `/api/v1` and `/v1` (see `app.ts`), so the full paths are
 * e.g. `POST /api/v1/orders/:id/checkout`.
 *
 * Flow: create order (orders module) -> checkout here -> customer pays on
 * Stripe -> Stripe calls the webhook -> client polls payment status.
 * See `README.md` in this folder for the full walkthrough.
 */
import { Router } from "express";
import { authenticate } from "../../middlewares/auth.js";
import {
  checkoutHandler,
  getPaymentStatusHandler,
  stripeWebhookHandler,
} from "./payment.controller.js";

const router = Router();

// Customer-facing endpoints: require a valid access token.
// Ownership (or ADMIN) is enforced in the service layer, not here.
router.post("/orders/:id/checkout", authenticate, checkoutHandler);
router.get("/orders/:id/payment", authenticate, getPaymentStatusHandler);

// Called by Stripe's servers, so there is no user token. Authenticity comes from
// the `stripe-signature` header instead. This route needs the RAW request body
// to verify that signature; `app.ts` mounts `express.raw()` for this path and
// skips the JSON parser. Do not add a JSON body parser in front of it.
router.post("/webhooks/stripe", stripeWebhookHandler);

export default router;
