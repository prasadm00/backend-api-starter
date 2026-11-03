import { prisma } from "../../config/prisma.js";
import type { CreateProductInput, UpdateProductInput, ProductQueryInput } from "./product.types.js";
import { Prisma } from "@prisma/client";

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

export async function findProductById(id: string) {
  return prisma.product.findUnique({
    where: { id },
    include: {
      inventory: true,
    },
  });
}

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
      orderBy: [{ [sortBy]: sortOrder } as Prisma.ProductOrderByWithRelationInput, { id: "asc" }],
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

export async function updateProduct(id: string, data: UpdateProductInput) {
  return prisma.$transaction(async (tx) => {
    const updateData: Prisma.ProductUpdateInput = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.price !== undefined) updateData.price = new Prisma.Decimal(data.price);
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

export async function updateProductStatus(id: string, status: "ACTIVE" | "INACTIVE") {
  return prisma.product.update({
    where: { id },
    data: { status },
    include: {
      inventory: true,
    },
  });
}
