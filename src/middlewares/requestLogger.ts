import type { Request, Response, NextFunction } from "express";
import { logger } from "../common/logger.js";

export const requestLoggerMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const startTime = Date.now();
  const requestId = (req as Request & { requestId?: string }).requestId;

  res.on("finish", () => {
    const durationMs = Date.now() - startTime;
    const logEntry = {
      requestId,
      method: req.method,
      route: req.path,
      statusCode: res.statusCode,
      durationMs,
    };

    if (res.statusCode >= 500) {
      logger.error(logEntry);
    } else if (res.statusCode >= 400) {
      logger.warn(logEntry);
    } else {
      logger.info(logEntry);
    }
  });

  return next();
};
