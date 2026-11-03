import {
  createProductWithInventory,
  findProductById,
  listProducts,
  updateProduct as updateProductRepo,
  updateProductStatus as updateProductStatusRepo,
} from "./product.repository.js";
import type { CreateProductInput, UpdateProductInput, ProductQueryInput } from "./product.types.js";
import { NotFoundError } from "../../errors/AppError.js";
import { cacheService } from "../../common/cache/cache.service.js";

export async function createProduct(data: CreateProductInput, createdBy: string) {
  const product = await createProductWithInventory(data, createdBy);

  // Invalidate list caches; cache errors should not roll back committed writes.
  await cacheService.delPattern("product:list:*");

  return product;
}

export async function getProductById(id: string) {
  const cacheKey = `product:v1:${id}`;
  const cached = await cacheService.get<any>(cacheKey);
  if (cached) {
    return cached;
  }

  const product = await findProductById(id);
  if (!product) {
    throw new NotFoundError("Product not found");
  }

  // Cache for 60 seconds
  await cacheService.set(cacheKey, product, 60);

  return product;
}

export async function getProducts(query: ProductQueryInput) {
  const cacheKey = `product:list:${JSON.stringify(query)}`;
  const cached = await cacheService.get<any>(cacheKey);
  if (cached) {
    return cached;
  }

  const result = await listProducts(query);

  // Cache public list for 30 seconds
  await cacheService.set(cacheKey, result, 30);

  return result;
}

export async function updateProduct(id: string, data: UpdateProductInput) {
  const existing = await findProductById(id);
  if (!existing) {
    throw new NotFoundError("Product not found");
  }

  const updated = await updateProductRepo(id, data);

  // Invalidate caches
  await cacheService.del(`product:v1:${id}`);
  await cacheService.delPattern("product:list:*");

  return updated;
}

export async function changeProductStatus(id: string, status: "ACTIVE" | "INACTIVE") {
  const existing = await findProductById(id);
  if (!existing) {
    throw new NotFoundError("Product not found");
  }

  const updated = await updateProductStatusRepo(id, status);

  // Invalidate caches
  await cacheService.del(`product:v1:${id}`);
  await cacheService.delPattern("product:list:*");

  return updated;
}
