import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(100, "Password too long"),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(6, "Invalid Password").max(100, "Invalid Password"),
});

export const refreshTokenSchema = z.object({ refreshToken: z.string().min(1) });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;