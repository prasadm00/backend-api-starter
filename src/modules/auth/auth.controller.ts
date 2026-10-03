import type { Request, Response } from "express";
import { type LoginInput, type RegisterInput, type RefreshTokenInput } from "./auth.types";
import {
  registerUser as registerUserService,
  loginUser as loginUserService,
  refreshAccessToken as refreshAccessTokenService,
  logoutUser as logoutUserService,
} from "./auth.service";
import { logger } from "../../common/logger";

export async function registerUser(req: Request, res: Response) {
  const input = req.body as RegisterInput;

  const user = await registerUserService(input);

  res.status(201).json({
    message: "User registered successfully",
    user,
  });
}

export async function loginUser(req: Request, res: Response) {
  const input = req.body as LoginInput;

  const loginCredentials = await loginUserService(input);
  logger.info(loginCredentials);

  res.cookie("refreshToken", loginCredentials.refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  return res.status(200).json({
    message: "Login successful!",
    data: loginCredentials,
  });
}

export async function refreshAccessToken(req: Request, res: Response) {
  const input = req.body as RefreshTokenInput;

  const tokens = await refreshAccessTokenService(input);

  // Set new refresh token in cookie
  res.cookie("refreshToken", tokens.refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  return res.status(200).json({
    message: "Token refreshed successfully",
    data: tokens,
  });
}

export async function logoutUser(req: Request, res: Response) {
  // Get user from auth middleware (we'll add it later)
  const userId = (req as Request & { userId?: string }).userId;

  if (userId) {
    await logoutUserService(userId);
  }

  // Clear refresh token cookie
  res.clearCookie("refreshToken");

  return res.status(200).json({
    message: "Logged out successfully",
  });
}