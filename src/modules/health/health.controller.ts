import type { Request, Response } from "express";
import { checkLiveness, checkReadiness } from "./health.service";

/**
 * Liveness Check: process is alive
 * Returns 200 if server process is running.
 * Failure causes orchestrator/service restart.
 */
export function getLiveness(req: Request, res: Response) {
  const result = checkLiveness();
  return res.status(200).json(result);
}

/**
 * Readiness Check: service can receive traffic
 * Verifies core dependencies (Database and Redis).
 * Returns 200 when all dependencies are ready.
 * Returns 503 when any dependency is down (tells load balancer: "Don't Send Traffic").
 */
export async function getReadiness(req: Request, res: Response) {
  const { statusCode, response } = await checkReadiness();
  return res.status(statusCode).json(response);
}
