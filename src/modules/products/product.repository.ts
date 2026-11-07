import { prisma } from "../../config/prisma.js";
import type {
  CreateProductInput,
  UpdateProductInput,
  ProductQueryInput,
} from "./product.types.js";
import { Prisma } from "@prisma/client";

/*
 * Product repository (database layer).
 *
 * Flow: routes -> validate -> controller -> service -> repository.
 * Plain Prisma access; caching and "not found" decisions are made in the service.
 */

/**
 * Inserts a product and its inventory row in a single nested write.
 *
 * @returns The created product including `inventory`.
 */
export async function createProductWithInventory(
  data: CreateProductInput,
  createdBy: string,
) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        name: data.name,
        description: data.description,
        price: new Prisma.Decimal(data.price),
        currency: data.currency,
        createdBy,
        inventory: {
          create: {
            availableQuantity: data.stock,
            reservedQuantity: 0,
          },
        },
      },
      include: {
        inventory: true,
      },
    });

    return product;
  });
}

/**
 * Loads a product with its inventory.
 *
 * @returns The product, or `null` when it doesn't exist.
 */
export async function findProductById(id: string) {
  return prisma.product.findUnique({
    where: { id },
    include: {
      inventory: true,
    },
  });
}

/**
 * Returns one page of products, optionally filtered by status and a case-insensitive
 * name/description search, plus pagination metadata.
 *
 * @returns `{ products, pagination }`; `totalPages` is at least 1 even when empty.
 */
export async function listProducts(query: ProductQueryInput) {
  const { page, limit, status, search, sortBy, sortOrder } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.ProductWhereInput = {};

  if (status) {
    where.status = status;
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take: limit,
      // `id` is a tie-breaker: sort fields like price or name can repeat, and without a
      // unique secondary key rows could shift between pages.
      orderBy: [
        { [sortBy]: sortOrder } as Prisma.ProductOrderByWithRelationInput,
        { id: "asc" },
      ],
      include: {
        inventory: true,
      },
    }),
    prisma.product.count({ where }),
  ]);

  return {
    products,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * Applies a partial update to a product and, if `stock` is given, to its inventory.
 *
 * Both writes share one transaction so the product and its stock change together.
 * Only fields that are present in `data` are written.
 *
 * @returns The updated product including `inventory`.
 */
export async function updateProduct(id: string, data: UpdateProductInput) {
  return prisma.$transaction(async (tx) => {
    const updateData: Prisma.ProductUpdateInput = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined)
      updateData.description = data.description;
    if (data.price !== undefined)
      updateData.price = new Prisma.Decimal(data.price);
    if (data.currency !== undefined) updateData.currency = data.currency;

    if (data.stock !== undefined) {
      await tx.inventory.upsert({
        where: { productId: id },
        create: {
          productId: id,
          availableQuantity: data.stock,
          reservedQuantity: 0,
        },
        // stock is defined as AVAILABLE inventory, not total units including reservations.
        update: { availableQuantity: data.stock },
      });
    }

    const updated = await tx.product.update({
      where: { id },
      data: updateData,
      include: {
        inventory: true,
      },
    });

    return updated;
  });
}

/**
 * Sets a product's status.
 *
 * @returns The updated product including `inventory`.
 */
export async function updateProductStatus(
  id: string,
  status: "ACTIVE" | "INACTIVE",
) {
  return prisma.product.update({
    where: { id },
    data: { status },
    include: {
      inventory: true,
    },
  });
}
