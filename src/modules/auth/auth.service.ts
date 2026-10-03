import { findUserByEmail, createUser, createRefreshToken } from "./auth.repository";
import { type LoginInput, type RegisterInput, type RefreshTokenInput } from "./auth.types";
import { ConflictError, UnauthorizedError, BadRequestError } from "../../errors/AppError";
import { logger } from "../../common/logger";
import { generateAccessToken, generateRefreshToken } from "../../common/token";
import { findRefreshToken, revokeRefreshToken, revokeAllUserTokens } from "./auth.repository";
import { queueService, type QueueService } from "../../common/queue";
import argon2 from "argon2";
import crypto from "crypto";

const JWT_EXPIRES_IN = (process.env.JWT_ACCESS_EXPIRES_IN || "1h") as string;
const JWT_REFRESH_EXPIRES_IN = parseInt(process.env.JWT_REFRESH_EXPIRES_IN || "7", 10);

export interface RegisterDependencies {
  findUserByEmail?: typeof findUserByEmail;
  createUser?: typeof createUser;
  queue?: QueueService;
}

export async function registerUser(
  input: RegisterInput,
  deps: RegisterDependencies = {},
) {
  const { email, password } = input;
  const findUser = deps.findUserByEmail ?? findUserByEmail;
  const create = deps.createUser ?? createUser;
  const queue = deps.queue ?? queueService;

  logger.info({ email }, "Checking if user exists");

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

  logger.info({ userId: user.id, email: user.email }, "User created successfully");

  // Publish USER_REGISTERED event only after DB transaction is committed
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

export async function loginUser(input: LoginInput) {
  const { email, password } = input;

  logger.info({ email }, "Check Email exists");

  // Check if email exists
  const userExists = await findUserByEmail(email);
  if (!userExists) {
    throw new UnauthorizedError("Invalid email or password");
  }

  const isPasswordValid = await argon2.verify(userExists.passwordHash || "", password);
  if (!isPasswordValid) {
    throw new UnauthorizedError("Invalid email or password");
  }

  const roles = userExists.roles.map((ur) => ur.role.name);

  const accessToken = generateAccessToken({
    userId: userExists.id,
    email: userExists.email,
    roles,
  });

  const tokenString = crypto.randomBytes(40).toString("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + JWT_REFRESH_EXPIRES_IN);

  await createRefreshToken(tokenString, userExists.id, expiresAt);

  return {
    accessToken,
    refreshToken: tokenString,
    user: {
      id: userExists.id,
      email: userExists.email,
    },
  };
}

export async function refreshAccessToken(input: RefreshTokenInput) {
  const { refreshToken } = input;

  // Find valid refresh token in DB
  const storedToken = await findRefreshToken(refreshToken);

  if (!storedToken) {
    throw new UnauthorizedError("Invalid or expired refresh token");
  }

  // Revoke old refresh token (token rotation for security)
  await revokeRefreshToken(refreshToken);

  // Generate new tokens
  const user = storedToken.user;
  const roles = user.roles?.map((ur) => ur.role.name) || [];
  const newAccessToken = generateAccessToken({
    userId: user.id,
    email: user.email,
    roles,
  });

  // Generate new refresh token
  const newRefreshToken = generateRefreshToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + JWT_REFRESH_EXPIRES_IN);

  await createRefreshToken(newRefreshToken, user.id, expiresAt);

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  };
}

export async function logoutUser(userId: string) {
  await revokeAllUserTokens(userId);
  return { message: "Logged out successfully" };
}