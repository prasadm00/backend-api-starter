import Stripe from "stripe";
import { env } from "../../config/env.js";
import { AppError, UnauthorizedError } from "../../errors/AppError.js";

let client: Stripe | undefined;
function getStripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY.includes("placeholder")) {
    throw new AppError("Stripe is not configured", 503, "PAYMENTS_UNAVAILABLE");
  }
  return client ??= new Stripe(env.STRIPE_SECRET_KEY);
}

export async function createStripeCheckoutSession(params: {
  orderId: string; userId: string; userEmail: string; currency: string; expiresAt: Date;
  items: { name: string; quantity: number; unitPrice: number }[];
}): Promise<{ sessionId: string; sessionUrl: string }> {
  const stripe = getStripe();
  const lineItems = params.items.map(item => ({
    price_data: {
      currency: params.currency.toLowerCase(), product_data: { name: item.name },
      unit_amount: Math.round(item.unitPrice * 100),
    },
    quantity: item.quantity,
  }));
  const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const session = await stripe.checkout.sessions.create({
    mode: "payment", customer_email: params.userEmail,
    client_reference_id: params.orderId,
    metadata: { orderId: params.orderId, userId: params.userId },
    line_items: lineItems,
    expires_at: Math.floor(params.expiresAt.getTime() / 1000),
    success_url: `${baseUrl}/checkout/return?result=success&order_id=${encodeURIComponent(params.orderId)}`,
    cancel_url: `${baseUrl}/checkout/return?result=cancelled&order_id=${encodeURIComponent(params.orderId)}`,
  }, { idempotencyKey: `checkout:${params.orderId}` });
  if (!session.url) throw new AppError("Stripe Checkout URL unavailable", 502, "PAYMENTS_UNAVAILABLE");
  return { sessionId: session.id, sessionUrl: session.url };
}

export async function retrieveCheckoutSession(id: string) {
  return getStripe().checkout.sessions.retrieve(id);
}

export function constructStripeEvent(rawBody: Buffer, signature: string): Stripe.Event {
  // Reject unsigned/incorrectly parsed requests even if Stripe is not configured.
  if (!Buffer.isBuffer(rawBody) || !signature) throw new UnauthorizedError("Missing signed Stripe event");
  if (!env.STRIPE_WEBHOOK_SECRET || env.STRIPE_WEBHOOK_SECRET.includes("placeholder")) {
    throw new AppError("Stripe webhook signing secret missing", 503, "PAYMENTS_UNAVAILABLE");
  }
  try { return getStripe().webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET); }
  catch { throw new UnauthorizedError("Invalid Stripe webhook signature"); }
}
