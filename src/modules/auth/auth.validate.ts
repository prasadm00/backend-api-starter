import { type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { ValidationError } from "../../errors/AppError.js";
import { loginSchema, registerSchema } from "./auth.types.js";

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
