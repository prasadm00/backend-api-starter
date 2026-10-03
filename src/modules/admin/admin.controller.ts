import type { Request, Response } from "express";

export function getAdminHealth(req: Request, res: Response) {
  return res.status(200).json({
    status: "ok",
    message: "Admin health check passed",
    timestamp: new Date().toISOString(),
  });
}
