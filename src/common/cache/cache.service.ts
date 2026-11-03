import { redisClient, connectRedis } from "../../config/redis.js";
import { logger } from "../logger.js";

export class CacheService {
  private defaultTTL = 60; // 60 seconds

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

  async set(key: string, value: unknown, ttlSeconds: number = this.defaultTTL): Promise<void> {
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

  async delPattern(pattern: string): Promise<void> {
    try {
      if (!redisClient.isOpen) {
        await connectRedis();
      }
      // SCAN is incremental; KEYS can block Redis on large datasets.
      for await (const keys of redisClient.scanIterator({ MATCH: pattern, COUNT: 100 })) {
        if (keys.length > 0) await redisClient.del(keys);
      }
    } catch (err) {
      logger.warn({ err, pattern }, "Cache delPattern error");
    }
  }
}

export const cacheService = new CacheService();
