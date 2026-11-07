/**
 * Type augmentation for Express's `Request`.
 *
 * Declares the properties our middleware attaches, so `req.user` etc. type-check
 * without casts. Types only; nothing here exists at runtime.
 */
import "express";
declare global {
  namespace Express {
    interface Request {
      // Set by requestIdMiddleware.
      requestId?: string;
      // Parsed query from the products/orders validators (req.query is left as-is).
      validatedQuery?: unknown;
      // Set by `authenticate`; roles come from the DB when it is reachable.
      user?: { userId: string; email: string; roles: string[] };
    }
  }
}
export {};
