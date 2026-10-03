import jwt from "jsonwebtoken";
import { env } from "../config/env";

export interface TokenPayload {
  userId: string;
  email: string;
  roles?: string[];
}

export function generateAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}

export function generateRefreshToken(): string {
  return jwt.sign({ type: "refresh" }, env.JWT_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
}