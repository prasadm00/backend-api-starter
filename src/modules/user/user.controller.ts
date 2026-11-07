import type { Request, Response } from "express";
import { getUserProfile } from "./user.service.js";

/*
 * User controllers: thin HTTP layer (routes -> controller -> service -> repository).
 * Reads the caller's identity from `req.user` and returns the service result.
 */

/**
 * GET /users/me
 *
 * Returns the authenticated caller's own profile. The id comes from the token, never from the URL.
 */

export async function getMe(req: Request, res: Response) {
  const user = req.user as any;
  const userId = user?.userId || user?.sub;

  const profile = await getUserProfile(userId);

  return res.status(200).json({
    status: "success",
    data: profile,
  });
}
