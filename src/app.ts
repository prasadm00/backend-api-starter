/**
 * Express application assembly.
 *
 * Builds the `app` (middleware chain, routes, 404 and global error handler) and
 * exports it without listening, so `server.ts` owns the port and process
 * lifecycle. Middleware order matters here; see the notes on each block.
 */
import express, {
  type Application,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { requestIdMiddleware } from "./middlewares/requestId.js";
import { requestLoggerMiddleware } from "./middlewares/requestLogger.js";
import { logger } from "./common/logger.js";
import { NotFoundError } from "./errors/AppError.js";
import { env } from "./config/env.js";

import authRoutes from "./modules/auth/auth.routes.js";
import adminRoutes from "./modules/admin/admin.routes.js";
import healthRoutes from "./modules/health/health.routes.js";
import productRoutes from "./modules/products/product.routes.js";
import orderRoutes from "./modules/orders/order.routes.js";
import userRoutes from "./modules/user/user.routes.js";
import paymentRoutes from "./modules/payments/payment.routes.js";
import { swaggerRouter } from "./docs/swagger.js";

const app: Application = express();

// Security Headers & Cross-Origin Resource Sharing
// Registered first so every response, including errors and 404s, carries them.
app.use(helmet());
app.use(
  cors({
    // CORS_ORIGINS is a comma-separated allow-list; blanks are dropped.
    // `credentials: true` lets browsers send cookies cross-origin, which is
    // only safe because origins are an explicit list, not a wildcard.
    origin: env.CORS_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    credentials: true,
  }),
);

// Cookie Parser
app.use(cookieParser());

// Request Tracking & Logging
// The id must be assigned before the logger runs so every log line for a
// request (and the error handler's output) can be correlated.
app.use(requestIdMiddleware);
app.use(requestLoggerMiddleware);

// Mount Stripe webhook with raw body parsing BEFORE global express.json()
// Stripe signs the exact bytes it sent. If express.json() parsed the body first,
// re-serializing it would change the bytes and signature verification would fail.
// With express.raw, `req.body` is a Buffer that the webhook handler passes on
// untouched. The small limit bounds what an unauthenticated caller can send.
app.use(
  "/api/v1/webhooks/stripe",
  express.raw({ type: "application/json", limit: "256kb" }),
);
app.use(
  "/v1/webhooks/stripe",
  express.raw({ type: "application/json", limit: "256kb" }),
);

// Standard Body Parsers (bypass on Stripe webhook routes which require raw Buffer)
// The path check skips the parsers for the webhook under either mount, so the
// Buffer produced above is not replaced. The 100kb limits cap request size;
// oversize bodies surface as `entity.too.large` in the error handler (-> 413).
app.use((req: Request, res: Response, next: NextFunction) => {
  if (
    req.originalUrl?.includes("/webhooks/stripe") ||
    req.path?.includes("/webhooks/stripe")
  ) {
    return next();
  }
  express.json({ limit: "100kb" })(req, res, next);
});
app.use((req: Request, res: Response, next: NextFunction) => {
  if (
    req.originalUrl?.includes("/webhooks/stripe") ||
    req.path?.includes("/webhooks/stripe")
  ) {
    return next();
  }
  express.urlencoded({ extended: false, limit: "100kb" })(req, res, next);
});

// Root Health & Greeting
app.get("/", (req: Request, res: Response) => {
  const requestId = (req as Request & { requestId?: string }).requestId;
  res.json({
    status: "ok",
    message: "E-Commerce Backend API is running",
    requestId,
  });
});

// Public return landing page. Never present a redirect as verified payment success.
// Stripe's success_url/cancel_url point here, but anyone can open this URL by hand.
// Only the signed webhook marks an order paid, so the page says so explicitly.
app.get("/checkout/return", (_req: Request, res: Response) => {
  res
    .type("html")
    .send(
      '<!doctype html><html lang="en"><head><title>Checkout returned</title></head><body><h1>Checkout returned</h1><p>This page does not confirm payment. Sign in and check the order payment status in the API.</p></body></html>',
    );
});

// Swagger Interactive Documentation
app.use("/docs", swaggerRouter);
app.use("/api-docs", swaggerRouter);

// Kubernetes Health Probes: GET /health/live, GET /health/ready
app.use("/health", healthRoutes);

// Feature Modules Mounting (both /api/v1 and /v1 supported)
// Each router is mounted under both prefixes so clients can use either form.
// The payment router is mounted at the version root because it defines its own
// paths (e.g. /orders/:id/checkout and /webhooks/stripe).
app.use("/api/v1/auth", authRoutes);
app.use("/v1/auth", authRoutes);

app.use("/api/v1/admin", adminRoutes);
app.use("/v1/admin", adminRoutes);

app.use("/api/v1/users", userRoutes);
app.use("/v1/users", userRoutes);

app.use("/api/v1/products", productRoutes);
app.use("/v1/products", productRoutes);

app.use("/api/v1/orders", orderRoutes);
app.use("/v1/orders", orderRoutes);

app.use("/api/v1", paymentRoutes);
app.use("/v1", paymentRoutes);

// Explicit 404 Handler for Unmatched Routes
// Must come after all routes. It forwards a NotFoundError so 404s get the same
// JSON shape as every other error via the handler below.
app.use((req: Request, res: Response, next: NextFunction) => {
  next(new NotFoundError(`Resource not found: ${req.method} ${req.path}`));
});

// Centralized Global Error Handler
// Express identifies error handlers by their four-argument signature, so `next`
// must stay in the parameter list even though it is unused. Must be registered last.
app.use(
  (
    err: Error & {
      statusCode?: number;
      code?: string;
      details?: unknown;
      isOperational?: boolean;
    },
    req: Request,
    res: Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    next: NextFunction,
  ) => {
    // Operational errors are expected (bad input, not found, ...) so they log at
    // warn with only name/message/code. Anything else is a bug: log the full error.
    if (err.isOperational) {
      logger.warn(
        {
          err: { name: err.name, message: err.message, code: err.code },
          path: req.path,
        },
        "Operational error",
      );
    } else {
      logger.error({ err, path: req.path }, "Unhandled application error");
    }

    // Bounded JSON parser errors should return client statuses, not leak a 500.
    const parserStatus =
      (err as Error & { type?: string; status?: number }).type ===
      "entity.too.large"
        ? 413
        : err instanceof SyntaxError && "body" in err
          ? 400
          : undefined;
    if (parserStatus)
      return res.status(parserStatus).json({
        code: parserStatus === 413 ? "PAYLOAD_TOO_LARGE" : "BAD_JSON",
        message:
          parserStatus === 413
            ? "Request payload too large"
            : "Malformed JSON payload",
      });
    // Operational errors carry a client-safe message, status and code, so they
    // are returned as-is (plus `details` as `errors`, e.g. validation failures).
    if (err.isOperational && err.statusCode) {
      const response: Record<string, unknown> = {
        code: err.code || "ERROR",
        message: err.message,
      };
      if (err.details) {
        response.errors = err.details;
      }
      return res.status(err.statusCode).json(response);
    }

    // Unexpected errors: generic body only, so messages and stack traces
    // (already logged above) never reach the client.
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
  },
);

export default app;
