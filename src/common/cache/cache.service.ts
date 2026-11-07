/**
 * Redis-backed JSON cache.
 *
 * Designed for cache-aside use: callers read the cache first and fall back to the
 * database on a miss. Every method swallows Redis errors (logging a warning), so
 * a Redis outage degrades to "no cache" rather than failing the request.
 */
import { redisClient, connectRedis } from "../../config/redis.js";
import { logger } from "../logger.js";

export class CacheService {
  private defaultTTL = 60; // 60 seconds

  /**
   * Returns the cached value for `key`, or `null` on a miss.
   * Also returns `null` (never throws) if Redis or JSON parsing fails, so callers
   * treat errors the same as a miss and read from the database.
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      if (!redisClient.isOpen) {
        await connectRedis();
      }
      const data = await redisClient.get(key);
      if (!data) return null;
      return JSON.parse(data) as T;
    } catch (err) {
      logger.warn({ err, key }, "Cache GET error - falling back to database");
      return null;
    }
  }

  /** Stores `value` as JSON with a TTL (default 60s). Failures are logged, not thrown. */
  async set(
    key: string,
    value: unknown,
    ttlSeconds: number = this.defaultTTL,
  ): Promise<void> {
    try {
      if (!redisClient.isOpen) {
        await connectRedis();
      }
      const serialized = JSON.stringify(value);
      await redisClient.set(key, serialized, { EX: ttlSeconds });
    } catch (err) {
      logger.warn({ err, key }, "Cache SET error - continuing without cache");
    }
  }

  /**
   * Removes one key (invalidation after writes). Failures are logged, not thrown,
   * so a failed delete can leave a stale entry until its TTL expires.
   */
  async del(key: string): Promise<void> {
    try {
      if (!redisClient.isOpen) {
        await connectRedis();
      }
      await redisClient.del(key);
    } catch (err) {
      logger.warn({ err, key }, "Cache DEL error");
    }
  }

  /** Removes every key matching a glob `pattern` (e.g. `products:*`). Failures are logged, not thrown. */
  async delPattern(pattern: string): Promise<void> {
    try {
      if (!redisClient.isOpen) {
        await connectRedis();
      }
      // SCAN is incremental; KEYS can block Redis on large datasets.
      for await (const keys of redisClient.scanIterator({
        MATCH: pattern,
        COUNT: 100,
      })) {
        if (keys.length > 0) await redisClient.del(keys);
      }
    } catch (err) {
      logger.warn({ err, pattern }, "Cache delPattern error");
    }
  }
}

/** Shared instance used across the app. */
export const cacheService = new CacheService();
