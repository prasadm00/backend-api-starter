import type { Request, Response } from "express";
import { checkLiveness, checkReadiness } from "./health.service.js";

/*
 * Health controllers: map probe results to HTTP responses (routes -> controller -> service).
 * Two probes exist because they answer different questions: "is the process alive?"
 * (restart it if not) versus "can it serve traffic now?" (stop routing to it if not).
 */

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
