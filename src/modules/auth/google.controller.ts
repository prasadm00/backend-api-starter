import type { Request, Response } from "express";
import {
  getGoogleAuthUrl,
  handleGoogleCallback,
  verifyGoogleFlow,
} from "./google.service.js";
import { setRefreshCookie } from "./auth.cookies.js";
import { BadRequestError } from "../../errors/AppError.js";
import { env } from "../../config/env.js";

/*
 * Google OAuth controllers. They carry the signed OAuth flow state between the
 * "start" request and the Google redirect back to the callback, using a short-lived
 * cookie. All protocol logic (state, PKCE, nonce, ID-token checks) is in
 * `google.service.ts`.
 */

// Flags for the temporary flow cookie. `lax` matters here: the callback is a top-level
// navigation coming back from Google, which a `strict` cookie would not be sent on.
const oauthCookie = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.NODE_ENV === "production",
  path: "/",
};

/**
 * GET /auth/google
 *
 * Starts a Google sign-in. Returns the Google consent URL and stores the signed
 * flow (state, nonce, PKCE verifier) in a 10-minute HttpOnly cookie.
 *
 * @throws {AppError} 503 (from the service) when Google OAuth isn't configured.
 */
export function googleAuthUrlHandler(_req: Request, res: Response) {
  const { url, cookie } = getGoogleAuthUrl();
  res.cookie("google_oauth_flow", cookie, {
    ...oauthCookie,
    maxAge: 10 * 60_000,
  });
  return res.json({ url });
}
/**
 * GET /auth/google/link
 *
 * Starts linking Google to the currently logged-in account (the route runs
 * `authenticate` first). The user id is stored in the signed flow cookie so the
 * callback knows which account to attach the Google identity to.
 *
 * @throws {AppError} 503 (from the service) when Google OAuth isn't configured.
 * @throws {UnauthorizedError} 401 (from the service) when there is no authenticated user.
 */
export function googleLinkStartHandler(req: Request, res: Response) {
  const { url, cookie } = getGoogleAuthUrl("link", req.user?.userId);
  res.cookie("google_oauth_flow", cookie, {
    ...oauthCookie,
    maxAge: 10 * 60_000,
  });
  return res.json({ url });
}
/**
 * GET /auth/google/callback
 *
 * Handles Google's redirect back. Verifies the `state` query value against the flow
 * cookie, then either links the Google identity (link mode) or logs in / provisions
 * a user (login mode, which sets the refresh cookie like a password login).
 *
 * @throws {UnauthorizedError} 401 when the flow cookie or state is missing, expired or mismatched.
 * @throws {BadRequestError} 400 when the authorization code is missing or login yields no token.
 */
export async function googleCallbackHandler(req: Request, res: Response) {
  const { code, state } = req.query;
  // Checking state before anything else ties this callback to the browser that started it.
  const flow = verifyGoogleFlow(
    req.cookies?.google_oauth_flow,
    typeof state === "string" ? state : undefined,
  );
  // The flow is single-purpose, so drop the cookie as soon as it has been verified.
  res.clearCookie("google_oauth_flow", oauthCookie);
  if (typeof code !== "string")
    throw new BadRequestError("Google authorization code required");
  const result = await handleGoogleCallback(code, flow);
  if (result.linked)
    return res.json({
      message: "Google account linked",
      alreadyLinked: result.alreadyLinked,
    });
  if (!result.refreshToken) throw new BadRequestError("Google login failed");
  setRefreshCookie(res, result.refreshToken);
  return res.json({
    message: "Google login successful",
    data: { accessToken: result.accessToken, user: result.user },
  });
}
