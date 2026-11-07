/**
 * Shared structured logger (pino).
 *
 * Every module logs through this instance so output format, level and secret
 * redaction are configured in one place.
 */
import pino from "pino";

/**
 * Application-wide pino logger.
 *
 * Level comes from `LOG_LEVEL` (default "info"). Outside production, output is
 * piped through pino-pretty for readability; in production it stays JSON.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  formatters: {
    // Emit the level as a name ("info") instead of pino's numeric default.
    level(label) {
      return { level: label };
    },
  },
  // Mask credentials (auth headers, cookies, passwords, tokens, secrets) so they
  // never reach log storage. Paths are matched by key, so both top-level and
  // one-level-nested (`*.token`) fields are covered; deeper nesting is not.
  redact: {
    paths: [
      "req.headers.authorization",
      "headers.authorization",
      "req.headers.cookie",
      "headers.cookie",
      "cookie",
      "clientSecret",
      "secret",
      "*.clientSecret",
      "*.secret",
      "authorization",
      "password",
      "passwordHash",
      "token",
      "accessToken",
      "refreshToken",
      "tokenHash",
      "*.password",
      "*.token",
      "*.accessToken",
      "*.refreshToken",
      "*.tokenHash",
    ],
    censor: "[REDACTED]",
  },
  ...(process.env.NODE_ENV !== "production" && {
    transport: { target: "pino-pretty", options: { colorize: true } },
  }),
});
