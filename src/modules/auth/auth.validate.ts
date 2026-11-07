import { type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { ValidationError } from "../../errors/AppError.js";
import { loginSchema, registerSchema } from "./auth.types.js";

/*
 * Request-validation middleware for the auth routes. They run before the
 * controllers (routes -> validate -> controller -> service -> repository), so
 * handlers only ever see bodies that already match the Zod schemas in
 * `auth.types.ts`. Failures are passed to `next()` as a `ValidationError` and
 * rendered by the global error handler.
 */

/**
 * Validates the POST /auth/register body against `registerSchema`.
 *
 * On success `req.body` is replaced with the parsed data, so downstream code
 * receives the schema's output rather than the raw input.
 *
 * @throws {ValidationError} 400 (via `next`) when the body doesn't match the schema.
 */
export function validateUserRegister(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const result = registerSchema.safeParse(req.body);

  if (!result.success) {
    const errors = result.error.issues.map((err: z.ZodIssue) => ({
      field: err.path.join("."),
      message: err.message,
    }));
    next(new ValidationError("Invalid user data", errors));
    return;
  }

  req.body = result.data;
  next();
}

/**
 * Validates the POST /auth/login body against `loginSchema`.
 *
 * The top-level message is the generic "Invalid email or password"; per-field
 * details are attached in the `errors` list.
 *
 * @throws {ValidationError} 400 (via `next`) when the body doesn't match the schema.
 */
export function validateUserLogin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const result = loginSchema.safeParse(req.body);

  if (!result.success) {
    const errors = result.error.issues.map((err: z.ZodIssue) => ({
      field: err.path.join("."),
      message: err.message,
    }));
    next(new ValidationError("Invalid email or password", errors));
    return;
  }
  req.body = result.data;

  next();
}
