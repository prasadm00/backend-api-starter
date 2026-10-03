import express, {
  type Application,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { requestIdMiddleware } from "./middlewares/requestId";
import { requestLoggerMiddleware } from "./middlewares/requestLogger";
import { logger } from "./common/logger";
import authRoutes from "./modules/auth/auth.routes";
import adminRoutes from "./modules/admin/admin.routes";
import healthRoutes from "./modules/health/health.routes";
import { swaggerRouter } from "./docs/swagger";

const app: Application = express();

// Global Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request ID middleware - adds x-request-id to every response
app.use(requestIdMiddleware);

// Request logger middleware - logs HTTP request details in JSON format
app.use(requestLoggerMiddleware);

app.get("/", (req: Request, res: Response) => {
  const requestId = (req as Request & { requestId?: string }).requestId;
  console.log("Root endpoint called, requestId:", requestId);
  res.json({ message: "Hello from app.ts!" });
});

// Swagger API Documentation
app.use("/docs", swaggerRouter);
app.use("/api-docs", swaggerRouter);

// Health check endpoints: GET /health/live, GET /health/ready
app.use("/health", healthRoutes);

// Admin routes: GET /api/v1/admin/health
app.use("/api/v1/admin", adminRoutes);
app.use("/v1/admin", adminRoutes);

// Auth routes
app.use("/api/v1/auth", authRoutes);
app.use("/v1/auth", authRoutes);



// Global error handler
app.use(
  (
    err: Error & { statusCode?: number; code?: string; details?: unknown; isOperational?: boolean },
    req: Request,
    res: Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    next: NextFunction
  ) => {
    // Only log non-operational errors as actual errors
    if (err.isOperational) {
      logger.warn({ err: { name: err.name, message: err.message, code: err.code }, path: req.path }, "Operational error");
    } else {
      logger.error({ err, path: req.path }, "Unhandled error");
    }

    if (err.statusCode) {
      const response: Record<string, unknown> = {
        code: err.code || "ERROR",
        message: err.message,
      };
      if (err.details) {
        response.errors = err.details;
      }
      return res.status(err.statusCode).json(response);
    }

    res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
  }
);

export default app;
