import type { NextFunction, Request, Response } from "express";
import { ValidationError } from "../../errors/AppError.js";
import {
  createProductSchema,
  updateProductSchema,
  productStatusSchema,
  productQuerySchema,
} from "./product.types.js";
import { type z } from "zod";

export function validateProductCreate(req: Request, res: Response, next: NextFunction) {
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

export function validateProductUpdate(req: Request, res: Response, next: NextFunction) {
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

export function validateProductStatus(req: Request, res: Response, next: NextFunction) {
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

export function validateProductQuery(req: Request, res: Response, next: NextFunction) {
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