import { z } from "zod";

/*
 * Zod schemas and inferred types for order input. These only describe the shape of
 * the request; prices are deliberately absent because the server takes them from the DB.
 */

export const createOrderItemSchema = z.object({
  productId: z.string().uuid("Invalid product ID format"),
  quantity: z.coerce.number().int().positive("Quantity must be at least 1"),
});

// Each product may appear once (quantity carries the amount), at most 50 distinct items.
export const createOrderSchema = z.object({
  items: z
    .array(createOrderItemSchema)
    .min(1, "Order must contain at least one item")
    .max(50, "Too many order items")
    .refine(
      (items) =>
        new Set(items.map((item) => item.productId)).size === items.length,
      "Duplicate product IDs are not allowed",
    ),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

// Query values arrive as strings, so z.coerce converts them to numbers before checking.
export const orderQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(10),
  status: z
    .enum(["PENDING_PAYMENT", "PAID", "CANCELLED", "EXPIRED"])
    .optional(),
});

export type OrderQueryInput = z.infer<typeof orderQuerySchema>;
