import { z } from "zod";

/*
 * Zod schemas and inferred types for product input and queries.
 *
 * `.strict()` makes the create/update schemas reject unknown fields instead of silently
 * dropping them, so a typo like `stok` fails loudly. `z.coerce` is used for numbers
 * because query strings (and possibly JSON strings) arrive as text.
 */

export const createProductSchema = z
  .object({
    name: z
      .string()
      .min(2, "Name must be at least 2 characters")
      .max(120, "Name too long"),
    description: z.string().max(1000, "Description too long").default(""),
    price: z.coerce
      .number()
      .positive("Price must be greater than zero")
      .multipleOf(0.01, "Price must have at most 2 decimal places"),
    currency: z.enum(["USD", "EUR", "GBP", "INR"]).default("USD"),
    stock: z.coerce
      .number()
      .int()
      .nonnegative("Stock cannot be negative")
      .default(0),
  })
  .strict();

export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    description: z.string().max(1000).optional(),
    price: z.coerce
      .number()
      .positive("Price must be greater than zero")
      .multipleOf(0.01, "Price must have at most 2 decimal places")
      .optional(),
    currency: z.enum(["USD", "EUR", "GBP", "INR"]).optional(),
    stock: z.coerce.number().int().nonnegative().optional(),
  })
  .strict();

export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const productStatusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE"]),
});

export type ProductStatusInput = z.infer<typeof productStatusSchema>;

// Sort fields are limited to an enum, so callers can't sort by arbitrary columns.
export const productQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  search: z.string().optional(),
  sortBy: z.enum(["createdAt", "price", "name"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type ProductQueryInput = z.infer<typeof productQuerySchema>;
