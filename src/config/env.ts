/**
 * Environment configuration.
 *
 * Loads `.env`, validates `process.env` against a zod schema once at startup, and
 * exports the typed result as `env`. Other modules read config from here, not from
 * `process.env`, so they get coerced types and defaults.
 */
import "dotenv/config";
import { z } from "zod";

// Required (no default): DATABASE_URL and JWT_SECRET. Stripe, Google OAuth and
// email API settings are optional so the app can boot without those integrations.
const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must have at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z
    .string()
    .regex(/^\d+[smhd]$/, "Use duration such as 7d or 12h")
    .default("7d"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  EMAIL_TRANSPORT: z.enum(["log", "webhook"]).default("log"),
  EMAIL_API_URL: z.string().optional(),
  EMAIL_API_KEY: z.string().optional(),
  LOG_LEVEL: z.string().default("info"),
});
// Fail fast: exit at startup on invalid config instead of failing later at runtime.
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // Only variable names and error messages; never print values.
  console.error(
    "Invalid environment configuration:",
    parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; "),
  );
  process.exit(1);
}
/** Validated, typed environment variables. */
export const env = parsed.data;
