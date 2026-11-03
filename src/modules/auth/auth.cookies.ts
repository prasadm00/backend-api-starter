import type { Request, Response, CookieOptions } from "express";
import { env } from "../../config/env.js";
import { ForbiddenError } from "../../errors/AppError.js";

export const REFRESH_COOKIE = "refreshToken";
export function refreshTtlMs(): number {
  const match = /^(\d+)([smhd])$/.exec(env.JWT_REFRESH_EXPIRES_IN);
  if (!match) throw new Error("JWT_REFRESH_EXPIRES_IN must be a duration like 7d, 12h or 30m");
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Number(match[1]) * multipliers[match[2]!]!;
}
export const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
};
export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, { ...cookieOptions, maxAge: refreshTtlMs() });
}
export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
}
// Defense for browser cookie-backed state-changing requests. Non-browser clients
// may omit Origin, but never allow an unexpected browser Origin.
export function requireTrustedOrigin(req: Request): void {
  const origin = req.headers.origin;
  if (!origin) return;
  const allowed = env.CORS_ORIGINS.split(",").map(v => v.trim()).filter(Boolean);
  if (!allowed.includes(origin)) throw new ForbiddenError("Untrusted request origin");
}
