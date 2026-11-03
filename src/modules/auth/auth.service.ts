import {
  findUserByEmail,
  createUser,
  createRefreshToken,
  rotateRefreshTokenAtomic,
  revokeRefreshToken,
} from "./auth.repository.js";
import { type LoginInput, type RegisterInput, type RefreshTokenInput } from "./auth.types.js";
import { ConflictError, UnauthorizedError } from "../../errors/AppError.js";
import { logger } from "../../common/logger.js";
import {
  generateAccessToken,
  generateOpaqueRefreshToken,
} from "../../common/token.js";
import { type QueueService } from "../../common/queue.js";
import argon2 from "argon2";
import { refreshTtlMs } from "./auth.cookies.js";


export interface RegisterDependencies {
  findUserByEmail?: typeof findUserByEmail;
  createUser?: typeof createUser;
  queue?: QueueService;
}

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

  // Check if email already exists
  const existingUser = await findUser(email);
  if (existingUser) {
    throw new ConflictError("Email already registered");
  }

  // Create user with hashed password and default USER role (transaction committed in DB)
  const user = await create({
    email,
    password,
  });

  logger.info({ userId: user.id, email: user.email }, "User registered successfully in database");

  // Publish USER_REGISTERED event only after DB transaction is committed
  // Real registrations emit an event transactionally via the repository's outbox.
  // Explicit queue injection is retained for isolated unit tests.
  if (queue) await queue.publish("USER_REGISTERED", { userId: user.id, email: user.email });

  return {
    id: user.id,
    email: user.email,
    status: user.status,
    roles: user.roles.map((ur) => ur.role.name),
  };
}

export async function loginUser(input: LoginInput) {
  const email = input.email.toLowerCase().trim();
  const { password } = input;

  logger.info({ email }, "Processing user login attempt");

  const userExists = await findUserByEmail(email);
  if (!userExists) {
    throw new UnauthorizedError("Invalid email or password");
  }

  if (userExists.status === "DISABLED") {
    throw new UnauthorizedError("Invalid email or password");
  }

  // Social-only accounts have no password; do not call argon2 with an empty hash.
  const isPasswordValid = userExists.passwordHash
    ? await argon2.verify(userExists.passwordHash, password)
    : false;
  if (!isPasswordValid) {
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

export async function refreshAccessToken(input: RefreshTokenInput) {
  const { refreshToken } = input;
  if (!refreshToken) {
    throw new UnauthorizedError("Refresh token missing");
  }

  const newRefreshToken = generateOpaqueRefreshToken();
  const newExpiresAt = new Date();
  newExpiresAt.setTime(Date.now() + refreshTtlMs());

  // Atomically rotate refresh token in single DB transaction
  const user = await rotateRefreshTokenAtomic(refreshToken, newRefreshToken, newExpiresAt);

  const roles = user.roles.map((ur) => ur.role.name);

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

export async function logoutUser(refreshToken?: string) {
  // Logout is limited to the presented refresh session, not every user session.
  if (refreshToken) await revokeRefreshToken(refreshToken);
  return { message: "Logged out successfully" };
}