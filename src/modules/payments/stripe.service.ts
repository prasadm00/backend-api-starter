/**
 * Thin wrapper around the Stripe SDK.
 *
 * This is the only file that talks to Stripe directly. Keeping it isolated means
 * the rest of the payments module works with plain values, and the Stripe client
 * can be swapped or mocked in one place.
 */
import Stripe from "stripe";
import { env } from "../../config/env.js";
import { AppError, UnauthorizedError } from "../../errors/AppError.js";
import { logger } from "../../common/logger.js";

/** Lazily created singleton, so the app can boot (and serve non-payment routes) without Stripe keys. */
let client: Stripe | undefined;

/**
 * Returns the shared Stripe client.
 *
 * @throws {AppError} 503 `PAYMENTS_UNAVAILABLE` when the secret key is missing or a placeholder.
 */
function getStripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY.includes("placeholder")) {
    logger.error(
      "Stripe API key is missing or still a placeholder; payments unavailable",
    );
    throw new AppError("Stripe is not configured", 503, "PAYMENTS_UNAVAILABLE");
  }
  return (client ??= new Stripe(env.STRIPE_SECRET_KEY));
}

/**
 * Creates a Stripe-hosted Checkout session for an order.
 *
 * - The order id is stored twice (`client_reference_id` and `metadata.orderId`);
 *   the webhook requires both to match before trusting the event.
 * - `expires_at` is aligned with the stock reservation, so Stripe stops
 *   accepting payment when our reservation ends.
 * - The idempotency key makes retries of this call return the same session
 *   instead of creating a second one.
 *
 * @returns The session id (stored on the Payment row) and the URL to redirect the customer to.
 * @throws {AppError} 502 when Stripe returns a session without a URL.
 */
export async function createStripeCheckoutSession(params: {
  orderId: string;
  userId: string;
  userEmail: string;
  currency: string;
  expiresAt: Date;
  items: { name: string; quantity: number; unitPrice: number }[];
}): Promise<{ sessionId: string; sessionUrl: string }> {
  const stripe = getStripe();
  const lineItems = params.items.map((item) => ({
    price_data: {
      // Stripe expects lowercase ISO currency codes.
      currency: params.currency.toLowerCase(),
      product_data: { name: item.name },
      // Stripe amounts are integers in the minor unit (cents). Round to avoid
      // float artifacts such as 24.99 * 100 = 2498.9999999999995.
      unit_amount: Math.round(item.unitPrice * 100),
    },
    quantity: item.quantity,
  }));
  // Strip a trailing slash so the return URLs don't contain "//checkout".
  const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      customer_email: params.userEmail,
      client_reference_id: params.orderId,
      metadata: { orderId: params.orderId, userId: params.userId },
      line_items: lineItems,
      // Stripe wants Unix seconds; it requires this to be at least 30 minutes away,
      // which is why the service refuses checkout with < 31 minutes left.
      expires_at: Math.floor(params.expiresAt.getTime() / 1000),
      // These pages are for the customer's browser only. They do NOT confirm
      // payment; only the signed webhook does.
      success_url: `${baseUrl}/checkout/return?result=success&order_id=${encodeURIComponent(params.orderId)}`,
      cancel_url: `${baseUrl}/checkout/return?result=cancelled&order_id=${encodeURIComponent(params.orderId)}`,
    },
    { idempotencyKey: `checkout:${params.orderId}` },
  );
  if (!session.url) {
    logger.error(
      { orderId: params.orderId, sessionId: session.id },
      "Stripe Checkout session has no URL",
    );
    throw new AppError(
      "Stripe Checkout URL unavailable",
      502,
      "PAYMENTS_UNAVAILABLE",
    );
  }
  logger.info(
    {
      orderId: params.orderId,
      userId: params.userId,
      sessionId: session.id,
      currency: params.currency,
      lineItems: lineItems.length,
      expiresAt: params.expiresAt,
    },
    "Stripe Checkout session created",
  );
  return { sessionId: session.id, sessionUrl: session.url };
}

/**
 * Fetches the current state of a Checkout session from Stripe.
 * Used to decide whether an existing session can be reused (`status === "open"`).
 */
export async function retrieveCheckoutSession(id: string) {
  const session = await getStripe().checkout.sessions.retrieve(id);
  logger.debug(
    {
      sessionId: id,
      sessionStatus: session.status,
      paymentStatus: session.payment_status,
    },
    "Stripe Checkout session retrieved",
  );
  return session;
}

/**
 * Verifies a webhook request really came from Stripe and parses it.
 *
 * Stripe signs the exact request bytes with the webhook secret. Re-serialized
 * JSON would not match, which is why `rawBody` must be the untouched `Buffer`.
 *
 * @param rawBody   Raw request body as received (from `express.raw()`).
 * @param signature Value of the `stripe-signature` header.
 * @returns The verified Stripe event.
 * @throws {UnauthorizedError} 401 when the signature is missing or invalid.
 * @throws {AppError} 503 when the webhook secret is not configured.
 */
export function constructStripeEvent(
  rawBody: Buffer,
  signature: string,
): Stripe.Event {
  // Reject unsigned/incorrectly parsed requests even if Stripe is not configured.
  if (!Buffer.isBuffer(rawBody) || !signature) {
    logger.warn(
      {
        hasSignature: Boolean(signature),
        bodyIsRawBuffer: Buffer.isBuffer(rawBody),
      },
      "Stripe webhook rejected: missing stripe-signature header or body was not parsed as raw",
    );
    throw new UnauthorizedError("Missing signed Stripe event");
  }
  if (
    !env.STRIPE_WEBHOOK_SECRET ||
    env.STRIPE_WEBHOOK_SECRET.includes("placeholder")
  ) {
    logger.error(
      "Stripe webhook signing secret is missing or still a placeholder",
    );
    throw new AppError(
      "Stripe webhook signing secret missing",
      503,
      "PAYMENTS_UNAVAILABLE",
    );
  }
  try {
    return getStripe().webhooks.constructEvent(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (error) {
    // Stripe's error message describes why verification failed; it never contains the secret.
    logger.warn(
      {
        reason: error instanceof Error ? error.message : "unknown",
        bodyBytes: rawBody.length,
      },
      "Stripe webhook rejected: signature verification failed (check STRIPE_WEBHOOK_SECRET matches the `stripe listen` secret)",
    );
    throw new UnauthorizedError("Invalid Stripe webhook signature");
  }
}
