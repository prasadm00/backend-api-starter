import type { NextFunction, Request, Response, RequestHandler } from "express";
import { UnauthorizedError, ForbiddenError } from "../errors/AppError.js";
import { verifyAccessToken } from "../common/token.js";
import { findUserById } from "../modules/auth/auth.repository.js";

export const authenticate = (
  reqOrOptions?: Request | any,
  res?: Response,
  next?: NextFunction,
): any => {
  const handler: RequestHandler = async (req: Request, _res: Response, nextFn: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return nextFn(new UnauthorizedError("Authentication token missing or invalid"));
    }

    const token: string = authHeader.split(" ")[1] || "";
    let decoded: any;
    try {
      decoded = verifyAccessToken(token);
    } catch {
      return nextFn(new UnauthorizedError("Invalid or expired token"));
    }

    let userRoles: string[] = Array.isArray(decoded.roles) ? decoded.roles : [];

    // SEC-07: Verify current DB account status and roles when database is available
    if (decoded.userId) {
      try {
        const user = await findUserById(decoded.userId);
        if (user) {
          if (user.status === "DISABLED") {
            return nextFn(new UnauthorizedError("Account has been disabled"));
          }
          userRoles = user.roles.map(r => r.role.name);
        }
      } catch {
        // If DB is offline or mock test token used, rely on verified JWT claims
      }
    }

    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      roles: userRoles,
    };
    return nextFn();
  };

  if (reqOrOptions && res && next && typeof next === "function") {
    return handler(reqOrOptions as Request, res, next);
  }
  return handler;
};

export const authorize = (...allowedRoles: (string | string[])[]): RequestHandler => {
  const targetRoles = allowedRoles.flat();

  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || typeof req.user === "string") {
      return next(new UnauthorizedError("Authentication required"));
    }

    const user = req.user as any;
    let userRoles: string[] = [];

    if (Array.isArray(user.roles)) {
      userRoles = user.roles;
    } else if (typeof user.role === "string") {
      userRoles = [user.role];
    } else if (typeof user.roles === "string") {
      userRoles = [user.roles];
    }

    const hasRole = targetRoles.some((role) => userRoles.includes(role));
    if (!hasRole) {
      return next(new ForbiddenError("Access forbidden: insufficient permissions"));
    }
    return next();
  };
};
