import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import crypto from "node:crypto";
import { env } from "../config/env.js";

export interface TokenPayload { userId: string; email: string; roles: string[] }
const ISSUER = "backend-api";
const AUDIENCE = "backend-api-client";

export function generateAccessToken(payload: TokenPayload): string {
  const options: SignOptions = {
    algorithm: "HS256",
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: (env.JWT_EXPIRES_IN || "15m") as any,
  };
  return jwt.sign(payload, env.JWT_SECRET, options);
}
export function generateOpaqueRefreshToken(): string {
  return crypto.randomBytes(40).toString("hex");
}
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
export function verifyAccessToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE,
  }) as JwtPayload;
  if (typeof decoded.userId !== "string" || !decoded.userId || typeof decoded.email !== "string" || !Array.isArray(decoded.roles) || !decoded.roles.every((v: unknown) => typeof v === "string")) {
    throw new Error("Invalid access token claims");
  }
  return { userId: decoded.userId, email: decoded.email, roles: decoded.roles };
}
