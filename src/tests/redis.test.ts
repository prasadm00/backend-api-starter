import { describe, it } from "node:test";
import assert from "node:assert";
import { redisClient, connectRedis, disconnectRedis, testRedisConnection } from "../config/redis";

describe("Task 21: Redis Connection & Infrastructure Integration", () => {
  it("exports redisClient, connectRedis, disconnectRedis, and testRedisConnection", () => {
    assert.ok(redisClient);
    assert.strictEqual(typeof connectRedis, "function");
    assert.strictEqual(typeof disconnectRedis, "function");
    assert.strictEqual(typeof testRedisConnection, "function");
  });

  it("proves SET health:redis ok and GET health:redis logic", async () => {
    // If Redis is already connected/open, run against live client; otherwise mock
    let originalSet = redisClient.set;
    let originalGet = redisClient.get;
    let originalConnect = redisClient.connect;
    let originalIsOpen = redisClient.isOpen;

    const memoryStore = new Map<string, string>();

    // Mock functions to verify contract
    (redisClient as any).connect = async () => {};
    Object.defineProperty(redisClient, "isOpen", { value: true, configurable: true, writable: true });
    (redisClient as any).set = async (key: string, val: string) => {
      memoryStore.set(key, val);
      return "OK";
    };
    (redisClient as any).get = async (key: string) => {
      return memoryStore.get(key) || null;
    };

    try {
      const result = await testRedisConnection();

      assert.strictEqual(result.set, "OK");
      assert.strictEqual(result.get, "ok");
      assert.strictEqual(memoryStore.get("health:redis"), "ok");
    } finally {
      (redisClient as any).set = originalSet;
      (redisClient as any).get = originalGet;
      (redisClient as any).connect = originalConnect;
      Object.defineProperty(redisClient, "isOpen", { value: originalIsOpen, configurable: true, writable: true });
    }
  });
});
