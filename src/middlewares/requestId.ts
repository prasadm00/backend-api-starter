/**
 * Request correlation id.
 *
 * Gives each request an id stored on `req.requestId` and echoed in the
 * `x-request-id` response header, so logs and client reports can be matched up.
 */
import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

// Only short, plain-character ids are accepted from clients. Restricting the
// charset and length keeps arbitrary caller input out of logs and headers.
const SAFE_REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Reuses a valid incoming `x-request-id` (so an id can follow a call across
 * services) or generates a UUID, then exposes it on the request and response.
 */
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
