import { describe, it } from "node:test";
import assert from "node:assert";
import app from "../app";
import { testRequest } from "./testHelper";
import { prisma } from "../config/prisma";
import { redisClient } from "../config/redis";

describe("Task 24: Health Checks (Liveness and Readiness)", () => {
  describe("GET /health/live (Liveness Check)", () => {
    it("returns 200 OK indicating the process is alive", async () => {
      const res = await testRequest(app).get("/health/live");

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, "ok");
      assert.ok(typeof res.body.uptimeSeconds === "number");
      assert.ok(typeof res.body.timestamp === "string");
    });
  });

  describe("GET /health/ready (Readiness Check)", () => {
    it("returns 200 OK when both DB and Redis are healthy", async () => {
      const originalQueryRaw = prisma.$queryRawUnsafe;
      const originalPing = redisClient.ping;
      const originalConnect = redisClient.connect;
      const originalIsOpen = redisClient.isOpen;

      (prisma as any).$queryRawUnsafe = async () => [{ "1": 1 }];
      (redisClient as any).connect = async () => {};
      Object.defineProperty(redisClient, "isOpen", { value: true, configurable: true, writable: true });
      (redisClient as any).ping = async () => "PONG";

      try {
        const res = await testRequest(app).get("/health/ready");

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.status, "ready");
        assert.strictEqual(res.body.checks.database.status, "up");
        assert.strictEqual(res.body.checks.redis.status, "up");
      } finally {
        (prisma as any).$queryRawUnsafe = originalQueryRaw;
        (redisClient as any).ping = originalPing;
        (redisClient as any).connect = originalConnect;
        Object.defineProperty(redisClient, "isOpen", { value: originalIsOpen, configurable: true, writable: true });
      }
    });

    it("returns 503 Service Unavailable when DB is down (Don't Send Traffic)", async () => {
      const originalQueryRaw = prisma.$queryRawUnsafe;
      const originalPing = redisClient.ping;
      const originalConnect = redisClient.connect;
      const originalIsOpen = redisClient.isOpen;

      (prisma as any).$queryRawUnsafe = async () => {
        throw new Error("Database connection refused");
      };
      (redisClient as any).connect = async () => {};
      Object.defineProperty(redisClient, "isOpen", { value: true, configurable: true, writable: true });
      (redisClient as any).ping = async () => "PONG";

      try {
        const res = await testRequest(app).get("/health/ready");

        assert.strictEqual(res.status, 503);
        assert.strictEqual(res.body.status, "not_ready");
        assert.strictEqual(res.body.checks.database.status, "down");
        assert.ok(res.body.checks.database.error.includes("Database connection refused"));
        assert.strictEqual(res.body.checks.redis.status, "up");
      } finally {
        (prisma as any).$queryRawUnsafe = originalQueryRaw;
        (redisClient as any).ping = originalPing;
        (redisClient as any).connect = originalConnect;
        Object.defineProperty(redisClient, "isOpen", { value: originalIsOpen, configurable: true, writable: true });
      }
    });

    it("returns 503 Service Unavailable when Redis is down (Don't Send Traffic)", async () => {
      const originalQueryRaw = prisma.$queryRawUnsafe;
      const originalPing = redisClient.ping;
      const originalConnect = redisClient.connect;
      const originalIsOpen = redisClient.isOpen;

      (prisma as any).$queryRawUnsafe = async () => [{ "1": 1 }];
      (redisClient as any).connect = async () => {
        throw new Error("Redis connection timed out");
      };
      Object.defineProperty(redisClient, "isOpen", { value: false, configurable: true, writable: true });
      (redisClient as any).ping = async () => {
        throw new Error("Redis connection timed out");
      };

      try {
        const res = await testRequest(app).get("/health/ready");

        assert.strictEqual(res.status, 503);
        assert.strictEqual(res.body.status, "not_ready");
        assert.strictEqual(res.body.checks.database.status, "up");
        assert.strictEqual(res.body.checks.redis.status, "down");
        assert.ok(res.body.checks.redis.error.includes("Redis connection timed out"));
      } finally {
        (prisma as any).$queryRawUnsafe = originalQueryRaw;
        (redisClient as any).ping = originalPing;
        (redisClient as any).connect = originalConnect;
        Object.defineProperty(redisClient, "isOpen", { value: originalIsOpen, configurable: true, writable: true });
      }
    });
  });
});
