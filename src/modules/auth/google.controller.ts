import type { Request, Response } from "express";
import { getGoogleAuthUrl, handleGoogleCallback, verifyGoogleFlow } from "./google.service.js";
import { setRefreshCookie } from "./auth.cookies.js";
import { BadRequestError } from "../../errors/AppError.js";
import { env } from "../../config/env.js";

const oauthCookie = {
  httpOnly: true, sameSite: "lax" as const, secure: env.NODE_ENV === "production", path: "/",
};
export function googleAuthUrlHandler(_req: Request, res: Response) {
  const { url, cookie } = getGoogleAuthUrl();
  res.cookie("google_oauth_flow", cookie, { ...oauthCookie, maxAge: 10 * 60_000 });
  return res.json({ url });
}
export function googleLinkStartHandler(req: Request, res: Response) {
  const { url, cookie } = getGoogleAuthUrl("link", req.user?.userId);
  res.cookie("google_oauth_flow", cookie, { ...oauthCookie, maxAge: 10 * 60_000 });
  return res.json({ url });
}
export async function googleCallbackHandler(req: Request, res: Response) {
  const { code, state } = req.query;
  const flow = verifyGoogleFlow(req.cookies?.google_oauth_flow, typeof state === "string" ? state : undefined);
  res.clearCookie("google_oauth_flow", oauthCookie);
  if (typeof code !== "string") throw new BadRequestError("Google authorization code required");
  const result = await handleGoogleCallback(code, flow);
  if (result.linked) return res.json({ message: "Google account linked", alreadyLinked: result.alreadyLinked });
  if (!result.refreshToken) throw new BadRequestError("Google login failed");
  setRefreshCookie(res, result.refreshToken);
  return res.json({ message: "Google login successful", data: { accessToken: result.accessToken, user: result.user } });
}
