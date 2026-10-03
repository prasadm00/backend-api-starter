import { createClient, type RedisClientType } from "redis";
import { env } from "./env";
import { logger } from "../common/logger";

export const redisClient: RedisClientType = createClient({
  url: env.REDIS_URL,
});

redisClient.on("error", (err) => {
  logger.error({ err }, "Redis Client Error");
});

redisClient.on("connect", () => {
  logger.info("Redis Client Connected");
});

redisClient.on("ready", () => {
  logger.info("Redis Client Ready");
});

export async function connectRedis(): Promise<RedisClientType> {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
  return redisClient;
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient.isOpen) {
    await redisClient.quit();
  }
}

/**
 * Health check helper to verify Redis connectivity:
 * SET health:redis ok
 * GET health:redis
 */
export async function testRedisConnection(): Promise<{
  set: string | null;
  get: string | null;
}> {
  await connectRedis();
  const set = await redisClient.set("health:redis", "ok");
  const get = await redisClient.get("health:redis");
  return { set, get };
}
