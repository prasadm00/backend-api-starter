import app from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./common/logger.js";
import { disconnectRedis } from "./config/redis.js";
import { prisma } from "./config/prisma.js";
import { bullMqQueueService } from "./common/queue/bullmqQueue.service.js";

const server = app.listen(env.PORT, () => {
  logger.info(`Server is listening on port ${env.PORT} in ${env.NODE_ENV} mode`);
});

const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Gracefully terminating application server...`);

  server.close(async () => {
    logger.info("HTTP server stopped accepting new connections.");
    try {
      await bullMqQueueService.close();
      await disconnectRedis();
      await prisma.$disconnect();
      logger.info("Database, Redis, and Queue resources cleaned up successfully.");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error occurred during graceful shutdown");
      process.exit(1);
    }
  });

  setTimeout(() => {
    logger.error("Forcefully terminating server due to shutdown timeout.");
    process.exit(1);
  }, 10000).unref();
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

export default server;
