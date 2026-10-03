import "dotenv/config";
import { z } from "zod";

// Define and validate the shape of environment variables.
const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  JWT_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d")
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "Invalid environment variables:",
    JSON.stringify(z.treeifyError(parsed.error)),
  );
  process.exit(1);
}

// Validated, typed env object. Import this anywhere instead of process.env.
export const env = parsed.data;
