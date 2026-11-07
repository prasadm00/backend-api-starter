import { prisma } from "../../config/prisma.js";
import { redisClient, connectRedis } from "../../config/redis.js";
import { logger } from "../../common/logger.js";

/*
 * Health probes (routes -> controller -> service).
 *
 * Liveness only proves the Node process is running and never touches dependencies,
 * so a database outage can't make an orchestrator restart a healthy process.
 * Readiness actively checks PostgreSQL and Redis and reports 503 if either is down.
 */

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

/**
 * Liveness probe: reports that the process is running, with its uptime.
 *
 * @returns `{ status: "ok", uptimeSeconds, timestamp }`. Performs no I/O.
 */
export function checkLiveness() {
  return {
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Readiness probe: checks that the database (`SELECT 1`) and Redis (`PING`) respond.
 *
 * Never throws; a failing dependency is reported as "down" in the result. The full
 * error is logged, while the response only says "Dependency unavailable".
 *
 * @returns Overall `isReady`, HTTP `statusCode` (200 when both are up, else 503),
 *   and per-dependency status with latency.
 */
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
          ...(dbError ? { error: "Dependency unavailable" } : {}),
        },
        redis: {
          status: redisStatus,
          latencyMs: redisLatency,
          ...(redisError ? { error: "Dependency unavailable" } : {}),
        },
      },
      timestamp: new Date().toISOString(),
    },
  };
}
