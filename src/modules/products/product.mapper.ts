import type { Product, Inventory } from "@prisma/client";

export function toProductResponse(product: Product & { inventory?: Inventory | null }) {
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
