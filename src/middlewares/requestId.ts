import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

const SAFE_REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

export const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const incomingId = req.headers["x-request-id"];

  // Validate incoming ID or generate a new UUIDv4
  const requestId =
    typeof incomingId === "string" && SAFE_REQUEST_ID_REGEX.test(incomingId)
      ? incomingId
      : randomUUID();

  (req as Request & { requestId: string }).requestId = requestId;
  res.setHeader("x-request-id", requestId);

  next();
};
