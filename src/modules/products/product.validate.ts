import type { NextFunction, Request, Response } from "express";
import { ValidationError } from "../../errors/AppError.js";
import {
  createProductSchema,
  updateProductSchema,
  productStatusSchema,
  productQuerySchema,
} from "./product.types.js";
import { type z } from "zod";

/*
 * Product request validation middleware (routes -> validate -> controller).
 * Each function runs a Zod schema from `product.types.ts` and, on success, hands the
 * parsed (coerced, defaulted) value to the controller. Failures go to `next` as a
 * ValidationError (HTTP 422) with a per-field error list.
 */

/**
 * Validates the POST /products body and replaces `req.body` with the parsed result.
 *
 * @throws {ValidationError} 422 (passed to `next`) when the body is invalid or has unknown fields.
 */
export function validateProductCreate(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const result = createProductSchema.safeParse(req.body);

  if (!result.success) {
    const errors = result.error.issues.map((err: z.ZodIssue) => ({
      field: err.path.join("."),
      message: err.message,
    }));
    return next(new ValidationError("Invalid product data", errors));
  }

  req.body = result.data;
  return next();
}

/**
 * Validates the PATCH /products/:id body; all fields optional, unknown fields rejected.
 *
 * @throws {ValidationError} 422 (passed to `next`) when the body is invalid.
 */
export function validateProductUpdate(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const result = updateProductSchema.safeParse(req.body);

  if (!result.success) {
    const errors = result.error.issues.map((err: z.ZodIssue) => ({
      field: err.path.join("."),
      message: err.message,
    }));
    return next(new ValidationError("Invalid product update data", errors));
  }

  req.body = result.data;
  return next();
}

/**
 * Validates the PATCH /products/:id/status body (`status` must be ACTIVE or INACTIVE).
 *
 * @throws {ValidationError} 422 (passed to `next`) when the body is invalid.
 */
export function validateProductStatus(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const result = productStatusSchema.safeParse(req.body);

  if (!result.success) {
    const errors = result.error.issues.map((err: z.ZodIssue) => ({
      field: err.path.join("."),
      message: err.message,
    }));
    return next(new ValidationError("Invalid product status data", errors));
  }

  req.body = result.data;
  return next();
}

/**
 * Validates the GET /products query string and stores the result on `req.validatedQuery`.
 *
 * `req.query` itself is left untouched.
 *
 * @throws {ValidationError} 422 (passed to `next`) when the query is invalid.
 */
export function validateProductQuery(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const result = productQuerySchema.safeParse(req.query);

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
