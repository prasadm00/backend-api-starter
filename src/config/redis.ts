/**
 * Redis client singleton and connection helpers.
 *
 * The client is created at import time but not connected; `connectRedis()` connects
 * on first use. Timeouts and retries are kept short so an unreachable Redis fails
 * quickly (callers such as the cache then degrade) instead of stalling requests.
 */
import { createClient, type RedisClientType } from "redis";
import { env } from "./env.js";
import { logger } from "../common/logger.js";

/** Shared Redis client. Use `connectRedis()` to make sure it is open before commands. */
export const redisClient: RedisClientType = createClient({
  url: env.REDIS_URL,
  socket: {
    connectTimeout: 1500,
    // Back off briefly (capped at 500ms) for the first few retries, then return an
    // Error so the client stops reconnecting.
    reconnectStrategy: (retries) =>
      retries > 2
        ? new Error("Redis unavailable")
        : Math.min(100 * retries, 500),
  },
});

// node-redis emits "error" events; without a listener an unhandled one would
// throw and could crash the process.
redisClient.on("error", (err) => {
  logger.error({ err }, "Redis Client Error");
});

redisClient.on("connect", () => {
  logger.info("Redis Client Connected");
});

redisClient.on("ready", () => {
  logger.info("Redis Client Ready");
});

/**
 * Connects the shared client if it isn't already open, and returns it.
 * @throws {Error} If the connection cannot be established.
 */
export async function connectRedis(): Promise<RedisClientType> {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
  return redisClient;
}

/** Closes the connection if open (QUIT waits for pending commands). Used on shutdown. */
export async function disconnectRedis(): Promise<void> {
  if (redisClient.isOpen) {
    await redisClient.quit();
  }
}

/**
 * Health check helper to verify Redis connectivity:
 * SET health:redis ok
 * GET health:redis
 *
 * @returns The raw SET reply ("OK") and the GET value ("ok") for the caller to compare.
 * @throws {Error} If Redis is unreachable.
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
