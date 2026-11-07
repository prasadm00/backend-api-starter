import type { Request, Response, CookieOptions } from "express";
import { env } from "../../config/env.js";
import { ForbiddenError } from "../../errors/AppError.js";

/*
 * Refresh-token cookie helpers. The opaque refresh token is delivered to the
 * browser only as a cookie (never in the JSON body), and these helpers keep the
 * cookie flags and lifetime consistent. Used by `auth.controller.ts`,
 * `google.controller.ts` and `auth.service.ts` (for the token TTL).
 */

/** Name of the cookie that carries the opaque refresh token. */
export const REFRESH_COOKIE = "refreshToken";

/**
 * Converts `JWT_REFRESH_EXPIRES_IN` (e.g. `7d`, `12h`, `30m`, `45s`) to milliseconds.
 *
 * The same value is used for the cookie `maxAge` and the database expiry of the
 * refresh token, so both expire together.
 *
 * @throws {Error} when the env value isn't `<number><s|m|h|d>`.
 */
export function refreshTtlMs(): number {
  const match = /^(\d+)([smhd])$/.exec(env.JWT_REFRESH_EXPIRES_IN);
  if (!match)
    throw new Error(
      "JWT_REFRESH_EXPIRES_IN must be a duration like 7d, 12h or 30m",
    );
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return Number(match[1]) * multipliers[match[2]!]!;
}
/**
 * Shared cookie flags for the refresh cookie.
 *
 * - `httpOnly`: page JavaScript can't read the token, limiting theft via XSS.
 * - `secure`: HTTPS-only, enabled in production (off elsewhere so local HTTP works).
 * - `sameSite: "lax"`: the browser withholds the cookie on cross-site subrequests
 *   (a CSRF mitigation); `requireTrustedOrigin` adds a server-side check on top.
 *
 * Clearing a cookie only works when the same options are passed, which is why
 * `clearRefreshCookie` reuses this object.
 */
export const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
};

/** Sends the refresh token to the browser as a cookie that lives as long as the token does. */
export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...cookieOptions,
    maxAge: refreshTtlMs(),
  });
}
/** Removes the refresh cookie from the browser (used on logout). */
export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
}
// Defense for browser cookie-backed state-changing requests. Non-browser clients
// may omit Origin, but never allow an unexpected browser Origin.
/**
 * Rejects cookie-backed requests that come from an origin not in `CORS_ORIGINS`.
 *
 * A request with no `Origin` header is allowed through (see the comment above).
 * Called by login, refresh and logout.
 *
 * @throws {ForbiddenError} 403 when the request's Origin isn't on the allow-list.
 */
export function requireTrustedOrigin(req: Request): void {
  const origin = req.headers.origin;
  if (!origin) return;
  const allowed = env.CORS_ORIGINS.split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (!allowed.includes(origin))
    throw new ForbiddenError("Untrusted request origin");
}
