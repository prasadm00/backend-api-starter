import type { NextFunction, Request, Response } from "express";
import { ValidationError } from "../../errors/AppError.js";
import { createOrderSchema, orderQuerySchema } from "./order.types.js";
import { type z } from "zod";

export function validateCreateOrder(req: Request, res: Response, next: NextFunction) {
  const result = createOrderSchema.safeParse(req.body);

  if (!result.success) {
    const errors = result.error.issues.map((err: z.ZodIssue) => ({
      field: err.path.join("."),
      message: err.message,
    }));
    return next(new ValidationError("Invalid order data", errors));
  }

  req.body = result.data;
  return next();
}

export function validateOrderQuery(req: Request, res: Response, next: NextFunction) {
  const result = orderQuerySchema.safeParse(req.query);

  if (!result.success) {
    const errors = result.error.issues.map((err: z.ZodIssue) => ({
      field: err.path.join("."),
      message: err.message,
    }));
    return next(new ValidationError("Invalid query parameters", errors));
  }

  req.validatedQuery = result.data;
  return next();
}
