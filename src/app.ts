import express, {
  type Application,
  type Request,
  type Response,
} from "express";
import { requestIdMiddleware } from "./middlewares/requestId.js";
import { requestLoggerMiddleware } from "./middlewares/requestLogger.js";

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

app.get("/health/live", (req: Request, res: Response) => {
  res.json({ message: "Success!" }).status(200);
});

export default app;
