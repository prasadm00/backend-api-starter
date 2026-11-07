import {
  findUserByEmail,
  createUser,
  createRefreshToken,
  rotateRefreshTokenAtomic,
  revokeRefreshToken,
} from "./auth.repository.js";
import {
  type LoginInput,
  type RegisterInput,
  type RefreshTokenInput,
} from "./auth.types.js";
import { ConflictError, UnauthorizedError } from "../../errors/AppError.js";
import { logger } from "../../common/logger.js";
import {
  generateAccessToken,
  generateOpaqueRefreshToken,
} from "../../common/token.js";
import { type QueueService } from "../../common/queue.js";
import argon2 from "argon2";
import { refreshTtlMs } from "./auth.cookies.js";

/*
 * Auth business rules: registration, password login, refresh-token rotation and
 * logout. HTTP concerns (cookies, status codes) live in `auth.controller.ts` and
 * database work in `auth.repository.ts`.
 *
 * Tokens: the access token is a short-lived signed JWT. The refresh token is an
 * opaque random string; only its SHA-256 hash is stored (see the repository), so a
 * leaked database doesn't hand out usable refresh tokens.
 */

/** Optional overrides so registration can be unit-tested without a database or queue. */
export interface RegisterDependencies {
  findUserByEmail?: typeof findUserByEmail;
  createUser?: typeof createUser;
  queue?: QueueService;
}

/**
 * Registers a new password account with the default USER role.
 *
 * The email is lower-cased and trimmed so the same address can't be registered
 * twice with different casing. Password hashing and the USER_REGISTERED outbox
 * event are handled inside `createUser`.
 *
 * @returns The public user fields (id, email, status, role names); never the hash.
 * @throws {ConflictError} 409 when the email is already registered.
 */
export async function registerUser(
  input: RegisterInput,
  deps: RegisterDependencies = {},
) {
  const email = input.email.toLowerCase().trim();
  const password = input.password;
  const findUser = deps.findUserByEmail ?? findUserByEmail;
  const create = deps.createUser ?? createUser;
  const queue = deps.queue;

  logger.info({ email }, "Processing user registration");

  // Early check for a clean 409; the repository re-checks inside its transaction, and a
  // unique-constraint violation there is also mapped to ConflictError for concurrent signups.
  const existingUser = await findUser(email);
  if (existingUser) {
    throw new ConflictError("Email already registered");
  }

  // Create user with hashed password and default USER role (transaction committed in DB)
  const user = await create({
    email,
    password,
  });

  logger.info(
    { userId: user.id, email: user.email },
    "User registered successfully in database",
  );

  // Publish USER_REGISTERED event only after DB transaction is committed
  // Real registrations emit an event transactionally via the repository's outbox.
  // Explicit queue injection is retained for isolated unit tests.
  if (queue)
    await queue.publish("USER_REGISTERED", {
      userId: user.id,
      email: user.email,
    });

  return {
    id: user.id,
    email: user.email,
    status: user.status,
    roles: user.roles.map((ur) => ur.role.name),
  };
}

/**
 * Logs a user in with email and password.
 *
 * Unknown email, disabled account, wrong password and social-only account all
 * throw the same error, so a caller can't use the response to find out which
 * emails are registered (email enumeration).
 *
 * @returns A new access token, a new opaque refresh token (the controller puts it in a
 *   cookie) and the public user fields.
 * @throws {UnauthorizedError} 401 "Invalid email or password" for every failure case.
 */
export async function loginUser(input: LoginInput) {
  const email = input.email.toLowerCase().trim();
  const { password } = input;

  logger.info({ email }, "Processing user login attempt");

  // The API answers every failure identically; the real reason is only recorded in logs.
  const userExists = await findUserByEmail(email);
  if (!userExists) {
    logger.warn({ email, reason: "user_not_found" }, "Login failed");
    throw new UnauthorizedError("Invalid email or password");
  }

  if (userExists.status === "DISABLED") {
    logger.warn(
      { userId: userExists.id, reason: "account_disabled" },
      "Login failed",
    );
    throw new UnauthorizedError("Invalid email or password");
  }

  // Social-only accounts have no password; do not call argon2 with an empty hash.
  const isPasswordValid = userExists.passwordHash
    ? await argon2.verify(userExists.passwordHash, password)
    : false;
  if (!isPasswordValid) {
    logger.warn(
      {
        userId: userExists.id,
        reason: userExists.passwordHash
          ? "wrong_password"
          : "social_only_account",
      },
      "Login failed",
    );
    throw new UnauthorizedError("Invalid email or password");
  }

  const roles = userExists.roles.map((ur) => ur.role.name);

  const accessToken = generateAccessToken({
    userId: userExists.id,
    email: userExists.email,
    roles,
  });

  // Generate opaque refresh token
  const refreshToken = generateOpaqueRefreshToken();
  const expiresAt = new Date();
  expiresAt.setTime(Date.now() + refreshTtlMs());

  await createRefreshToken(refreshToken, userExists.id, expiresAt);

  logger.info({ userId: userExists.id, roles }, "Login successful");

  return {
    accessToken,
    refreshToken,
    user: {
      id: userExists.id,
      email: userExists.email,
      roles,
    },
  };
}

/**
 * Exchanges a refresh token for a new access token and a new refresh token.
 *
 * Refresh tokens are single-use: each one is revoked as it is exchanged
 * (rotation), so a stolen token that was already used is rejected. Roles in the
 * new access token are read fresh from the database.
 *
 * @throws {UnauthorizedError} 401 when the token is missing, unknown, expired,
 *   revoked/already used, or the account is disabled.
 */
export async function refreshAccessToken(input: RefreshTokenInput) {
  const { refreshToken } = input;
  if (!refreshToken) {
    logger.warn("Token refresh rejected: refresh token missing");
    throw new UnauthorizedError("Refresh token missing");
  }

  const newRefreshToken = generateOpaqueRefreshToken();
  const newExpiresAt = new Date();
  newExpiresAt.setTime(Date.now() + refreshTtlMs());

  // Atomically rotate refresh token in single DB transaction
  let user;
  try {
    user = await rotateRefreshTokenAtomic(
      refreshToken,
      newRefreshToken,
      newExpiresAt,
    );
  } catch (error) {
    // Expired, unknown or already-used (possible replay) refresh tokens end up here.
    logger.warn(
      { reason: error instanceof Error ? error.message : "unknown" },
      "Token refresh rejected: refresh token invalid, expired or already used",
    );
    throw error;
  }

  const roles = user.roles.map((ur) => ur.role.name);
  logger.info(
    { userId: user.id },
    "Access token refreshed; refresh token rotated",
  );

  const newAccessToken = generateAccessToken({
    userId: user.id,
    email: user.email,
    roles,
  });

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  };
}

/**
 * Ends the session identified by the given refresh token.
 *
 * Revoking an unknown token is a no-op, so this never errors for bad input.
 * Only the presented refresh token is revoked, not the user's other sessions.
 */
export async function logoutUser(refreshToken?: string) {
  // Logout is limited to the presented refresh session, not every user session.
  if (refreshToken) await revokeRefreshToken(refreshToken);
  logger.info({ hadRefreshToken: Boolean(refreshToken) }, "User logged out");
  return { message: "Logged out successfully" };
}
