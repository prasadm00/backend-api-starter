import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  formatters: {
    level(label) {
      return { level: label };
    },
  },
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
