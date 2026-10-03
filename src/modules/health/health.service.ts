import { prisma } from "../../config/prisma";
import { redisClient, connectRedis } from "../../config/redis";
import { logger } from "../../common/logger";

export interface CheckDetail {
  status: "up" | "down";
  latencyMs?: number;
  error?: string;
}

export interface ReadinessResult {
  isReady: boolean;
  statusCode: number;
  response: {
    status: "ready" | "not_ready";
    checks: {
      database: CheckDetail;
      redis: CheckDetail;
    };
    timestamp: string;
  };
}

export function checkLiveness() {
  return {
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}

export async function checkReadiness(): Promise<ReadinessResult> {
  const dbStart = Date.now();
  let dbStatus: "up" | "down" = "down";
  let dbError: string | undefined;

  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    dbStatus = "up";
  } catch (err: any) {
    dbStatus = "down";
    dbError = err?.message || "Database connection failed";
    logger.warn({ err }, "Readiness check: Database check failed");
  }
  const dbLatency = Date.now() - dbStart;

  const redisStart = Date.now();
  let redisStatus: "up" | "down" = "down";
  let redisError: string | undefined;

  try {
    if (!redisClient.isOpen) {
      await connectRedis();
    }
    const pong = await redisClient.ping();
    if (pong === "PONG") {
      redisStatus = "up";
    } else {
      redisStatus = "down";
      redisError = "Redis ping did not respond with PONG";
    }
  } catch (err: any) {
    redisStatus = "down";
    redisError = err?.message || "Redis connection failed";
    logger.warn({ err }, "Readiness check: Redis check failed");
  }
  const redisLatency = Date.now() - redisStart;

  const isReady = dbStatus === "up" && redisStatus === "up";

  return {
    isReady,
    statusCode: isReady ? 200 : 503,
    response: {
      status: isReady ? "ready" : "not_ready",
      checks: {
        database: {
          status: dbStatus,
          latencyMs: dbLatency,
          ...(dbError ? { error: dbError } : {}),
        },
        redis: {
          status: redisStatus,
          latencyMs: redisLatency,
          ...(redisError ? { error: redisError } : {}),
        },
      },
      timestamp: new Date().toISOString(),
    },
  };
}
