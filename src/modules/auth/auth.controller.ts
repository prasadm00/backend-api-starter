import type { Request, Response } from "express";
import type { LoginInput, RegisterInput } from "./auth.types.js";
import { registerUser as register, loginUser as login, refreshAccessToken as rotate, logoutUser as logout } from "./auth.service.js";
import { UnauthorizedError } from "../../errors/AppError.js";
import { REFRESH_COOKIE, setRefreshCookie, clearRefreshCookie, requireTrustedOrigin } from "./auth.cookies.js";

export async function registerUser(req: Request, res: Response) {
  const user = await register(req.body as RegisterInput);
  return res.status(201).json({ message: "User registered successfully", user });
}
export async function loginUser(req: Request, res: Response) {
  requireTrustedOrigin(req);
  const result = await login(req.body as LoginInput);
  setRefreshCookie(res, result.refreshToken);
  return res.json({ message: "Login successful", data: { accessToken: result.accessToken, user: result.user } });
}
export async function refreshAccessToken(req: Request, res: Response) {
  requireTrustedOrigin(req);
  const rawToken = req.cookies?.[REFRESH_COOKIE];
  if (typeof rawToken !== "string" || !rawToken) throw new UnauthorizedError("Refresh cookie required");
  const result = await rotate({ refreshToken: rawToken });
  setRefreshCookie(res, result.refreshToken);
  return res.json({ message: "Token refreshed", data: { accessToken: result.accessToken } });
}
export async function logoutUser(req: Request, res: Response) {
  requireTrustedOrigin(req);
  const rawToken = req.cookies?.[REFRESH_COOKIE];
  if (typeof rawToken === "string" && rawToken) await logout(rawToken);
  clearRefreshCookie(res);
  return res.json({ message: "Logged out successfully" });
}
