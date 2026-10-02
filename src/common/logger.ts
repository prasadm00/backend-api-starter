import pino from "pino";

export const logger = pino({
  // Set the default logging level based on the environment
  level: process.env.LOG_LEVEL || "info",

  // Formatters let you customize the output keys
  formatters: {
    level(label) {
      return { level: label }; // Converts numeric levels (like 30) into strings (like "info")
    },
  },

  // Pretty-print logs ONLY during local development (speeds up production)
  ...(process.env.NODE_ENV !== "production" && {
    transport: { target: "pino-pretty", options: { colorize: true } },
  }),
});
