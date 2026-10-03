import "express";
import type { JwtPayload } from "jsonwebtoken";

export interface RequestUser extends JwtPayload {
  userId?: string;
  sub?: string;
  email?: string;
  roles?: string[];
  role?: string;
}

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      user?: RequestUser | JwtPayload | string;
    }
  }
}

export {};