/**
 * Authentication and role-based authorization middleware.
 *
 * `authenticate` verifies the bearer access token and populates `req.user`.
 * `authorize` (also re-exported from `rbac.ts`) then checks that user's roles.
 */
import type { NextFunction, Request, Response, RequestHandler } from "express";
import { UnauthorizedError, ForbiddenError } from "../errors/AppError.js";
import { verifyAccessToken } from "../common/token.js";
import { findUserById } from "../modules/auth/auth.repository.js";
import { logger } from "../common/logger.js";

/**
 * Requires a valid `Authorization: Bearer <jwt>` header and sets `req.user`.
 *
 * Normally used as middleware (`authenticate()` returns the handler). It can
 * also be called directly as `authenticate(req, res, next)`, in which case it
 * runs the handler immediately.
 *
 * Failures are passed to `next` as `UnauthorizedError` (401), never thrown:
 * missing/malformed header, bad or expired token, or a DISABLED account.
 *
 * @returns The request handler, or the handler's promise when called directly.
 */
export const authenticate = (
  reqOrOptions?: Request | any,
  res?: Response,
  next?: NextFunction,
): any => {
  const handler: RequestHandler = async (
    req: Request,
    _res: Response,
    nextFn: NextFunction,
  ) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      logger.warn(
        { requestId: req.requestId, method: req.method, path: req.originalUrl },
        "Auth rejected: bearer token missing",
      );
      return nextFn(
        new UnauthorizedError("Authentication token missing or invalid"),
      );
    }

    const token: string = authHeader.split(" ")[1] || "";
    let decoded: any;
    try {
      decoded = verifyAccessToken(token);
    } catch (error) {
      logger.warn(
        {
          requestId: req.requestId,
          path: req.originalUrl,
          reason: error instanceof Error ? error.name : "unknown",
        },
        "Auth rejected: token invalid or expired",
      );
      return nextFn(new UnauthorizedError("Invalid or expired token"));
    }

    // Start from the roles signed into the token; replaced below when the DB answers.
    let userRoles: string[] = Array.isArray(decoded.roles) ? decoded.roles : [];

    // SEC-07: Verify current DB account status and roles when database is available
    // Re-read on every request (not just at login) so that disabling an account
    // or revoking a role takes effect immediately instead of when the token expires.
    if (decoded.userId) {
      try {
        const user = await findUserById(decoded.userId);
        if (user) {
          if (user.status === "DISABLED") {
            logger.warn(
              { requestId: req.requestId, userId: decoded.userId },
              "Auth rejected: account is disabled",
            );
            return nextFn(new UnauthorizedError("Account has been disabled"));
          }
          userRoles = user.roles.map((r) => r.role.name);
        }
      } catch (error) {
        // If DB is offline or mock test token used, rely on verified JWT claims
        // (the signature was already checked, but roles/status may be stale here).
        logger.warn(
          {
            requestId: req.requestId,
            userId: decoded.userId,
            err: error instanceof Error ? error.message : "unknown",
          },
          "Auth: could not refresh user roles/status from database; using token claims",
        );
      }
    }

    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      roles: userRoles,
    };
    return nextFn();
  };

  // Direct-call form: (req, res, next) were supplied, so run the handler now.
  if (reqOrOptions && res && next && typeof next === "function") {
    return handler(reqOrOptions as Request, res, next);
  }
  return handler;
};

/**
 * Builds a middleware that allows the request only if the user has at least one
 * of the given roles. Accepts roles as varargs or arrays, e.g. `authorize("ADMIN")`.
 *
 * Must run after `authenticate`. Passes `UnauthorizedError` (401) to `next` when
 * there is no user, and `ForbiddenError` (403) when no role matches.
 */
export const authorize = (
  ...allowedRoles: (string | string[])[]
): RequestHandler => {
  const targetRoles = allowedRoles.flat();

  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || typeof req.user === "string") {
      return next(new UnauthorizedError("Authentication required"));
    }

    const user = req.user as any;
    let userRoles: string[] = [];

    // Tolerate several shapes of role claim (array, single `role`, string `roles`).
    if (Array.isArray(user.roles)) {
      userRoles = user.roles;
    } else if (typeof user.role === "string") {
      userRoles = [user.role];
    } else if (typeof user.roles === "string") {
      userRoles = [user.roles];
    }

    const hasRole = targetRoles.some((role) => userRoles.includes(role));
    if (!hasRole) {
      logger.warn(
        {
          requestId: (req as Request).requestId,
          userId: user.userId,
          userRoles,
          requiredRoles: targetRoles,
          path: req.originalUrl,
        },
        "Authorization rejected: missing required role",
      );
      return next(
        new ForbiddenError("Access forbidden: insufficient permissions"),
      );
    }
    return next();
  };
};
