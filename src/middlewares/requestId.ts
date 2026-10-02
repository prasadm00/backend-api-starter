import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

export const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Check if request already has an ID (e.g., from a load balancer or proxy)
  const incomingId = req.headers["x-request-id"];

  // Use existing ID or generate a new one
  const requestId = typeof incomingId === "string" ? incomingId : randomUUID();

  // Attach to request for use in route handlers
  (req as Request & { requestId: string }).requestId = requestId;

  // Add to response header
  res.setHeader("x-request-id", requestId);

  next();
};
