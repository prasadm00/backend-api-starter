import type { NextFunction, Request, Response } from "express";
import { ValidationError } from "../../errors/AppError.js";
import { createOrderSchema, orderQuerySchema } from "./order.types.js";
import { type z } from "zod";

/*
 * Order request validation middleware (routes -> validate -> controller).
 * Runs the Zod schemas from `order.types.ts` before the controller, so handlers
 * only ever see parsed, typed input.
 */

/**
 * Validates the POST /orders body and replaces `req.body` with the parsed result.
 *
 * @throws {ValidationError} 422 (passed to `next`) when the body doesn't match the schema.
 */
export function validateCreateOrder(
  req: Request,
  res: Response,
  next: NextFunction,
) {
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

/**
 * Validates the GET /orders query string and stores the result on `req.validatedQuery`.
 *
 * The parsed value goes on `req.validatedQuery`; `req.query` itself is left untouched.
 *
 * @throws {ValidationError} 422 (passed to `next`) when the query is invalid.
 */
export function validateOrderQuery(
  req: Request,
  res: Response,
  next: NextFunction,
) {
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
