import type { NextFunction, Request, Response, RequestHandler } from "express";
import { UnauthorizedError, ForbiddenError } from "../errors/AppError";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

/**
 * Authentication middleware.
 * Supports both direct handler usage: `router.get(..., authenticate, ...)`
 * and factory invocation usage: `router.get(..., authenticate(), ...)`
 */
export const authenticate = (
  reqOrOptions?: Request | any,
  res?: Response,
  next?: NextFunction,
): any => {
  const handler: RequestHandler = (req: Request, _res: Response, nextFn: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return nextFn(new UnauthorizedError("Authentication token missing or invalid"));
      }

      const token: string = authHeader.split(" ")[1] || "";
      const secret = env.JWT_SECRET || process.env.JWT_SECRET || "";

      const decoded = jwt.verify(token, secret);
      req.user = decoded;

      return nextFn();
    } catch {
      return nextFn(new UnauthorizedError("Invalid or expired token"));
    }
  };

  // If called directly as middleware: authenticate(req, res, next)
  if (reqOrOptions && res && next && typeof next === "function") {
    return handler(reqOrOptions as Request, res, next);
  }

  // If called as a middleware factory: authenticate()
  return handler;
};

/**
 * Role-Based Access Control (RBAC) middleware factory.
 * Usage: `authorize("ADMIN")` or `authorize("ADMIN", "MANAGER")`
 *
 * Rules:
 * - 401 = not authenticated (no authenticated user present)
 * - 403 = authenticated but not allowed (user lacks required role)
 */
export const authorize = (...allowedRoles: (string | string[])[]) => {
  const targetRoles = allowedRoles.flat();

  return (req: Request, _res: Response, next: NextFunction): void => {
    // 1. Authenticated Request check
    if (!req.user) {
      return next(new UnauthorizedError("Authentication required"));
    }

    // 2. Read roles
    const user = req.user as any;
    let userRoles: string[] = [];

    if (Array.isArray(user.roles)) {
      userRoles = user.roles;
    } else if (typeof user.role === "string") {
      userRoles = [user.role];
    } else if (typeof user.roles === "string") {
      userRoles = [user.roles];
    }

    // 3. Check role authorization
    const hasRole = targetRoles.some((role) => userRoles.includes(role));

    if (!hasRole) {
      return next(new ForbiddenError("Access forbidden: insufficient permissions"));
    }

    // 4. Allow
    return next();
  };
};
