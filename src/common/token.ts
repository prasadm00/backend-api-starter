/**
 * Token helpers: signed JWT access tokens and opaque refresh tokens.
 *
 * Access tokens are short-lived JWTs verified on each request. Refresh tokens
 * are random strings with no embedded data; only their hash should be stored.
 */
import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import crypto from "node:crypto";
import { env } from "../config/env.js";

/** Claims carried in an access token. */
export interface TokenPayload {
  userId: string;
  email: string;
  roles: string[];
}
// Issuer/audience are set on sign and required on verify, so a token minted for
// some other service or audience is rejected even if the secret were shared.
const ISSUER = "backend-api";
const AUDIENCE = "backend-api-client";

/**
 * Signs an HS256 access token for the given user claims.
 * Lifetime is `JWT_EXPIRES_IN`, defaulting to 15 minutes.
 */
export function generateAccessToken(payload: TokenPayload): string {
  const options: SignOptions = {
    algorithm: "HS256",
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: (env.JWT_EXPIRES_IN || "15m") as any,
  };
  return jwt.sign(payload, env.JWT_SECRET, options);
}
/** Returns a random 80-character hex refresh token (40 bytes from the CSPRNG). */
export function generateOpaqueRefreshToken(): string {
  return crypto.randomBytes(40).toString("hex");
}
/** SHA-256 hex digest of a token, for storing/looking up tokens without keeping the raw value. */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
/**
 * Verifies an access token's signature, expiry, issuer and audience, and returns its claims.
 *
 * @throws {Error} From jsonwebtoken when the token is invalid or expired, or
 *   "Invalid access token claims" when the payload lacks the expected shape.
 */
export function verifyAccessToken(token: string): TokenPayload {
  // Pin the algorithm list so a token cannot choose its own (e.g. "none").
  const decoded = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ["HS256"],
    issuer: ISSUER,
    audience: AUDIENCE,
  }) as JwtPayload;
  // A valid signature doesn't guarantee our claim shape; check it before callers trust it.
  if (
    typeof decoded.userId !== "string" ||
    !decoded.userId ||
    typeof decoded.email !== "string" ||
    !Array.isArray(decoded.roles) ||
    !decoded.roles.every((v: unknown) => typeof v === "string")
  ) {
    throw new Error("Invalid access token claims");
  }
  return { userId: decoded.userId, email: decoded.email, roles: decoded.roles };
}
