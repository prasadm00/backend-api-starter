import type { Request, Response } from "express";
import {
  createProduct,
  getProductById,
  getProducts,
  updateProduct,
  changeProductStatus,
} from "./product.service.js";
import type {
  CreateProductInput,
  UpdateProductInput,
  ProductStatusInput,
  ProductQueryInput,
} from "./product.types.js";

/*
 * Product controllers.
 *
 * Thin HTTP layer (routes -> validate -> controller -> service -> repository): read
 * the request, call the service, shape the response. Business rules and caching live
 * in `product.service.ts`; thrown `AppError`s are handled by the global error handler.
 */

/**
 * POST /products (admin only)
 *
 * Creates a product with initial stock, recording the caller as its creator. Responds 201.
 */
export async function createProductHandler(req: Request, res: Response) {
  const user = req.user as any;
  const createdBy = user?.userId || user?.sub;
  const input = req.body as CreateProductInput;

  const product = await createProduct(input, createdBy);

  return res.status(201).json({
    status: "success",
    data: product,
  });
}

/**
 * GET /products/:id (public)
 *
 * Returns a single product.
 */
export async function getProductHandler(req: Request, res: Response) {
  const id = req.params.id as string;
  const product = await getProductById(id);

  return res.status(200).json({
    status: "success",
    data: product,
  });
}

/**
 * GET /products (public)
 *
 * Lists products with pagination. Reads `req.validatedQuery`, filled by
 * `validateProductQuery` with coerced, defaulted values.
 */
export async function listProductsHandler(req: Request, res: Response) {
  const query = req.validatedQuery as ProductQueryInput;
  const result = await getProducts(query);

  return res.status(200).json({
    status: "success",
    data: result.products,
    pagination: result.pagination,
  });
}

/**
 * PATCH /products/:id (admin only)
 *
 * Partially updates a product from the validated body.
 */
export async function updateProductHandler(req: Request, res: Response) {
  const id = req.params.id as string;
  const input = req.body as UpdateProductInput;

  const product = await updateProduct(id, input);

  return res.status(200).json({
    status: "success",
    data: product,
  });
}

/**
 * PATCH /products/:id/status (admin only)
 *
 * Switches a product between ACTIVE and INACTIVE.
 */
export async function changeProductStatusHandler(req: Request, res: Response) {
  const id = req.params.id as string;
  const { status } = req.body as ProductStatusInput;

  const product = await changeProductStatus(id, status);

  return res.status(200).json({
    status: "success",
    data: product,
  });
}
