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
app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGINS.split(",").map(origin => origin.trim()).filter(Boolean),
    credentials: true,
  }),
);

// Cookie Parser
app.use(cookieParser());

// Request Tracking & Logging
app.use(requestIdMiddleware);
app.use(requestLoggerMiddleware);

// Mount Stripe webhook with raw body parsing BEFORE global express.json()
app.use("/api/v1/webhooks/stripe", express.raw({ type: "application/json", limit: "256kb" }));
app.use("/v1/webhooks/stripe", express.raw({ type: "application/json", limit: "256kb" }));

// Standard Body Parsers (bypass on Stripe webhook routes which require raw Buffer)
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.originalUrl?.includes("/webhooks/stripe") || req.path?.includes("/webhooks/stripe")) {
    return next();
  }
  express.json({ limit: "100kb" })(req, res, next);
});
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.originalUrl?.includes("/webhooks/stripe") || req.path?.includes("/webhooks/stripe")) {
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
app.get("/checkout/return", (_req: Request, res: Response) => {
  res.type("html").send("<!doctype html><html lang=\"en\"><head><title>Checkout returned</title></head><body><h1>Checkout returned</h1><p>This page does not confirm payment. Sign in and check the order payment status in the API.</p></body></html>");
});

// Swagger Interactive Documentation
app.use("/docs", swaggerRouter);
app.use("/api-docs", swaggerRouter);

// Kubernetes Health Probes: GET /health/live, GET /health/ready
app.use("/health", healthRoutes);

// Feature Modules Mounting (both /api/v1 and /v1 supported)
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
app.use((req: Request, res: Response, next: NextFunction) => {
  next(new NotFoundError(`Resource not found: ${req.method} ${req.path}`));
});

// Centralized Global Error Handler
app.use(
  (
    err: Error & { statusCode?: number; code?: string; details?: unknown; isOperational?: boolean },
    req: Request,
    res: Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    next: NextFunction,
  ) => {
    if (err.isOperational) {
      logger.warn(
        { err: { name: err.name, message: err.message, code: err.code }, path: req.path },
        "Operational error",
      );
    } else {
      logger.error({ err, path: req.path }, "Unhandled application error");
    }

    // Bounded JSON parser errors should return client statuses, not leak a 500.
    const parserStatus = (err as Error & { type?: string; status?: number }).type === "entity.too.large" ? 413 :
      (err instanceof SyntaxError && "body" in err ? 400 : undefined);
    if (parserStatus) return res.status(parserStatus).json({
      code: parserStatus === 413 ? "PAYLOAD_TOO_LARGE" : "BAD_JSON",
      message: parserStatus === 413 ? "Request payload too large" : "Malformed JSON payload",
    });
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

    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
  },
);

export default app;
