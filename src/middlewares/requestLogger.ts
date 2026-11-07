/**
 * Access logging: one structured log line per completed request.
 */
import type { Request, Response, NextFunction } from "express";
import { logger } from "../common/logger.js";

/**
 * Logs method, route, status, duration, request id and user id when the response finishes.
 *
 * Runs after `requestIdMiddleware` so the id is available. The log level follows
 * the status code: 5xx error, 4xx warn, otherwise info.
 */
export const requestLoggerMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const startTime = Date.now();
  const requestId = (req as Request & { requestId?: string }).requestId;

  // Log on "finish" (not at request start) so status code and duration are known.
  // `req.user` is read here, after routing, because auth sets it later in the chain.
  res.on("finish", () => {
    const durationMs = Date.now() - startTime;
    const logEntry = {
      requestId,
      userId: req.user?.userId,
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
