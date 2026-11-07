/*
 * Zod schemas and inferred types for the auth module's inputs. The schemas are
 * applied by the middleware in `auth.validate.ts`; the types are used by the
 * controller and service layers.
 */
import { z } from "zod";

// The length rules differ: registration requires 10+ characters, while login only
// checks a looser 6-100 range before the real check (argon2 verify) in the service.
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

// Shape of the input to the service-level refresh. The controller builds it from the
// refresh cookie; no route validates a request body with this schema.
export const refreshTokenSchema = z.object({ refreshToken: z.string().min(1) });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
