import type { Request, Response } from "express";
import type { LoginInput, RegisterInput } from "./auth.types.js";
import {
  registerUser as register,
  loginUser as login,
  refreshAccessToken as rotate,
  logoutUser as logout,
} from "./auth.service.js";
import { UnauthorizedError } from "../../errors/AppError.js";
import {
  REFRESH_COOKIE,
  setRefreshCookie,
  clearRefreshCookie,
  requireTrustedOrigin,
} from "./auth.cookies.js";

/*
 * Auth controllers: register, login, refresh and logout.
 *
 * Controllers are thin: they read the request, call `auth.service.ts`, and
 * shape the response. This is also where the refresh token is moved between the
 * service and the HttpOnly cookie, so it never appears in a JSON body. Errors are
 * not caught here; thrown `AppError`s are turned into JSON by the global error handler.
 */

/**
 * POST /auth/register
 *
 * Creates a new account from the already-validated body.
 *
 * @returns 201 with the created user (id, email, status, roles).
 * @throws {ConflictError} 409 (from the service) when the email is already registered.
 */
export async function registerUser(req: Request, res: Response) {
  const user = await register(req.body as RegisterInput);
  return res
    .status(201)
    .json({ message: "User registered successfully", user });
}
/**
 * POST /auth/login
 *
 * Verifies credentials, returns the short-lived access token in the body and
 * sets the refresh token as an HttpOnly cookie.
 *
 * @throws {ForbiddenError} 403 when the request Origin isn't trusted.
 * @throws {UnauthorizedError} 401 (from the service) for any login failure.
 */
export async function loginUser(req: Request, res: Response) {
  // The login sets a cookie, so reject untrusted browser origins first.
  requireTrustedOrigin(req);
  const result = await login(req.body as LoginInput);
  setRefreshCookie(res, result.refreshToken);
  return res.json({
    message: "Login successful",
    data: { accessToken: result.accessToken, user: result.user },
  });
}
/**
 * POST /auth/refresh
 *
 * Exchanges the refresh cookie for a new access token and a new refresh cookie
 * (rotation: the old refresh token stops working).
 *
 * @throws {ForbiddenError} 403 when the request Origin isn't trusted.
 * @throws {UnauthorizedError} 401 when the cookie is missing, or the token is invalid,
 *   expired or already used.
 */
export async function refreshAccessToken(req: Request, res: Response) {
  // The refresh token is taken from the cookie only, so this endpoint is cookie-authenticated
  // and needs the Origin check.
  requireTrustedOrigin(req);
  const rawToken = req.cookies?.[REFRESH_COOKIE];
  if (typeof rawToken !== "string" || !rawToken)
    throw new UnauthorizedError("Refresh cookie required");
  const result = await rotate({ refreshToken: rawToken });
  setRefreshCookie(res, result.refreshToken);
  return res.json({
    message: "Token refreshed",
    data: { accessToken: result.accessToken },
  });
}
/**
 * POST /auth/logout
 *
 * Revokes the presented refresh token (if any) and clears the cookie. Succeeds
 * even without a cookie, so logging out twice is harmless.
 *
 * @throws {ForbiddenError} 403 when the request Origin isn't trusted.
 */
export async function logoutUser(req: Request, res: Response) {
  requireTrustedOrigin(req);
  const rawToken = req.cookies?.[REFRESH_COOKIE];
  if (typeof rawToken === "string" && rawToken) await logout(rawToken);
  // Cleared even when no token was presented, so the browser always ends up without the cookie.
  clearRefreshCookie(res);
  return res.json({ message: "Logged out successfully" });
}
