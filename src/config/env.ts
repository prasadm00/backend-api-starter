import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must have at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().regex(/^\d+[smhd]$/, "Use duration such as 7d or 12h").default("7d"),
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
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // Only variable names and error messages; never print values.
  console.error("Invalid environment configuration:", parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  process.exit(1);
}
export const env = parsed.data;
