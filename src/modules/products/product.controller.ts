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

export async function getProductHandler(req: Request, res: Response) {
  const id = req.params.id as string;
  const product = await getProductById(id);

  return res.status(200).json({
    status: "success",
    data: product,
  });
}

export async function listProductsHandler(req: Request, res: Response) {
  const query = req.validatedQuery as ProductQueryInput;
  const result = await getProducts(query);

  return res.status(200).json({
    status: "success",
    data: result.products,
    pagination: result.pagination,
  });
}

export async function updateProductHandler(req: Request, res: Response) {
  const id = req.params.id as string;
  const input = req.body as UpdateProductInput;

  const product = await updateProduct(id, input);

  return res.status(200).json({
    status: "success",
    data: product,
  });
}

export async function changeProductStatusHandler(req: Request, res: Response) {
  const id = req.params.id as string;
  const { status } = req.body as ProductStatusInput;

  const product = await changeProductStatus(id, status);

  return res.status(200).json({
    status: "success",
    data: product,
  });
}
