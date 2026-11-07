import type { Product, Inventory } from "@prisma/client";

/*
 * Mapper from Prisma product rows to the API response shape.
 */

/**
 * Converts a product (with optional inventory) into a plain response object.
 *
 * `price` becomes a JS number (Prisma returns a Decimal), and `stock` exposes only
 * available units, not reserved ones; it is 0 when no inventory row exists.
 */
export function toProductResponse(
  product: Product & { inventory?: Inventory | null },
) {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    price: product.price.toNumber(),
    currency: product.currency,
    status: product.status,
    stock: product.inventory ? product.inventory.availableQuantity : 0,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}
