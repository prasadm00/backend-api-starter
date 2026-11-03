import type { Request, Response } from "express";
import { getUserProfile } from "./user.service.js";

export async function getMe(req: Request, res: Response) {
  const user = req.user as any;
  const userId = user?.userId || user?.sub;

  const profile = await getUserProfile(userId);

  return res.status(200).json({
    status: "success",
    data: profile,
  });
}