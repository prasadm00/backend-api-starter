import type { Request, Response, NextFunction } from "express";
import { logger } from "../common/logger.js";

export const requestLoggerMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Capture start time
  const startTime = Date.now();

  // Get requestId with type cast
  const requestId = (req as Request & { requestId?: string }).requestId;

  // Override res.json to log after response is sent
  const originalJson = res.json.bind(res);

  res.json = (body: unknown) => {
    const durationMs = Date.now() - startTime;

    // Build log object in the exact format requested
    const logEntry = {
      requestId,
      method: req.method,
      route: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
    };

    // Log based on status code
    if (res.statusCode >= 500) {
      logger.error(logEntry);
    } else if (res.statusCode >= 400) {
      logger.warn(logEntry);
    } else {
      logger.info(logEntry);
    }

    return originalJson(body);
  };

  return next();
};
