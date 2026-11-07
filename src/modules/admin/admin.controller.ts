import type { Request, Response } from "express";

/*
 * Admin controllers. Only reachable through routes guarded by authenticate + authorize("ADMIN"),
 * so no role check is repeated here.
 */

/**
 * GET /admin/health
 *
 * Confirms the caller is authenticated as an ADMIN. It checks no dependencies;
 * see the health module for liveness and readiness probes.
 */

export function getAdminHealth(req: Request, res: Response) {
  return res.status(200).json({
    status: "ok",
    message: "Admin health check passed",
    timestamp: new Date().toISOString(),
  });
}
