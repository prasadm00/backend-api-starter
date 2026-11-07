import {
  createProductWithInventory,
  findProductById,
  listProducts,
  updateProduct as updateProductRepo,
  updateProductStatus as updateProductStatusRepo,
} from "./product.repository.js";
import type {
  CreateProductInput,
  UpdateProductInput,
  ProductQueryInput,
} from "./product.types.js";
import { NotFoundError } from "../../errors/AppError.js";
import { cacheService } from "../../common/cache/cache.service.js";
import { logger } from "../../common/logger.js";

/*
 * Product business rules and caching.
 *
 * Layer: routes -> validate -> controller -> service -> repository.
 * Reads use cache-aside on Redis: check the cache, fall back to the database on a
 * miss, then store the result with a short TTL. Writes clear the affected keys.
 * CacheService logs and swallows Redis errors, so a cache outage degrades to
 * database reads and never fails a request or a write that already committed.
 */

/**
 * Creates a product together with its inventory row (admin only, enforced in routes).
 *
 * Only list caches are cleared; a brand-new id can't have a detail entry yet.
 *
 * @param createdBy Id of the admin creating the product.
 * @returns The created product with inventory.
 */
export async function createProduct(
  data: CreateProductInput,
  createdBy: string,
) {
  const product = await createProductWithInventory(data, createdBy);

  // Invalidate list caches; cache errors should not roll back committed writes.
  await cacheService.delPattern("product:list:*");

  logger.info(
    {
      productId: product.id,
      createdBy,
      name: data.name,
      price: data.price,
      currency: data.currency,
      stock: data.stock,
    },
    "Product created",
  );
  return product;
}

/**
 * Returns one product, served from Redis when cached (60s TTL), else from the database.
 *
 * The `v1` in the key lets the cached shape be versioned if it ever changes.
 *
 * @returns The product with inventory.
 * @throws {NotFoundError} 404 product not found.
 */
export async function getProductById(id: string) {
  const cacheKey = `product:v1:${id}`;
  const cached = await cacheService.get<any>(cacheKey);
  if (cached) {
    logger.debug({ productId: id }, "Product served from cache");
    return cached;
  }

  const product = await findProductById(id);
  if (!product) {
    logger.warn({ productId: id }, "Product not found");
    throw new NotFoundError("Product not found");
  }
  logger.debug({ productId: id }, "Product loaded from database (cache miss)");

  // Cache for 60 seconds
  await cacheService.set(cacheKey, product, 60);

  return product;
}

/**
 * Returns a page of products, served from Redis when cached (30s TTL).
 *
 * The cache key embeds the whole query, so each distinct page/filter/sort combination
 * is cached separately. All of them share the `product:list:` prefix so a write can
 * clear them with one pattern delete.
 *
 * @returns `{ products, pagination }`.
 */
export async function getProducts(query: ProductQueryInput) {
  const cacheKey = `product:list:${JSON.stringify(query)}`;
  const cached = await cacheService.get<any>(cacheKey);
  if (cached) {
    logger.debug({ cacheKey }, "Product list served from cache");
    return cached;
  }
  logger.debug({ cacheKey }, "Product list cache miss; querying database");

  const result = await listProducts(query);

  // Cache public list for 30 seconds
  await cacheService.set(cacheKey, result, 30);

  return result;
}

/**
 * Applies a partial update to a product (admin only, enforced in routes).
 *
 * Clears the product's detail cache and every list cache afterwards, since a list
 * page can contain the changed product.
 *
 * @returns The updated product with inventory.
 * @throws {NotFoundError} 404 product not found.
 */
export async function updateProduct(id: string, data: UpdateProductInput) {
  const existing = await findProductById(id);
  if (!existing) {
    logger.warn({ productId: id }, "Product update rejected: not found");
    throw new NotFoundError("Product not found");
  }

  const updated = await updateProductRepo(id, data);

  // Invalidate caches
  await cacheService.del(`product:v1:${id}`);
  await cacheService.delPattern("product:list:*");

  logger.info(
    { productId: id, changedFields: Object.keys(data) },
    "Product updated",
  );
  return updated;
}

/**
 * Sets a product ACTIVE or INACTIVE (admin only, enforced in routes).
 *
 * Order creation rejects inactive products. Detail and list caches are cleared so
 * the new status shows up immediately.
 *
 * @returns The updated product with inventory.
 * @throws {NotFoundError} 404 product not found.
 */
export async function changeProductStatus(
  id: string,
  status: "ACTIVE" | "INACTIVE",
) {
  const existing = await findProductById(id);
  if (!existing) {
    logger.warn(
      { productId: id, status },
      "Product status change rejected: not found",
    );
    throw new NotFoundError("Product not found");
  }

  const updated = await updateProductStatusRepo(id, status);

  // Invalidate caches
  await cacheService.del(`product:v1:${id}`);
  await cacheService.delPattern("product:list:*");

  logger.info({ productId: id, status }, "Product status changed");
  return updated;
}
