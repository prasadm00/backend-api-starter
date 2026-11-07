import { prisma } from "../../config/prisma.js";
import { type RegisterInput } from "./auth.types.js";
import { ConflictError, UnauthorizedError } from "../../errors/AppError.js";
import { hashToken } from "../../common/token.js";
import argon2 from "argon2";
import { Prisma } from "@prisma/client";
import { logger } from "../../common/logger.js";

/*
 * Auth data access (Prisma): users, roles and refresh tokens. No business rules
 * beyond what must be atomic live here; `auth.service.ts` decides what to call.
 * Refresh tokens are stored only as SHA-256 hashes (`hashToken`), never as the raw
 * value the client holds.
 */

/** Finds a user (with roles) by email; the email is normalised to lower case. */
export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: {
      roles: {
        include: { role: true },
      },
    },
  });
}

/** Finds a user (with roles) by id, or `null`. */
export async function findUserById(id: string) {
  return prisma.user.findUnique({
    where: { id },
    include: {
      roles: {
        include: { role: true },
      },
    },
  });
}

/**
 * Creates a user with an argon2-hashed password and the USER role.
 *
 * The user row, the role link and a `USER_REGISTERED` outbox event are written in
 * one transaction (transactional outbox): the event exists if and only if the user
 * was committed, so a crash can't create a user with no event or an event for a
 * user that was rolled back.
 *
 * @returns The new user including roles.
 * @throws {ConflictError} 409 when the email exists (checked in the transaction, and
 *   also when the database reports a unique-constraint violation from a concurrent signup).
 */
export async function createUser(data: RegisterInput & { password: string }) {
  const normalizedEmail = data.email.toLowerCase().trim();

  // Get or create default USER role
  const role = await prisma.role.upsert({
    where: { name: "USER" },
    update: {},
    create: { name: "USER" },
  });

  // Pre-hash password before database transaction to avoid holding DB connection
  // (argon2 is deliberately slow and memory-hard, which makes offline guessing costly).
  const passwordHash = await argon2.hash(data.password);

  // Create user with role in a transaction
  return prisma
    .$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { email: normalizedEmail },
      });

      if (existingUser) {
        throw new ConflictError("Email already registered");
      }

      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          roles: {
            create: {
              roleId: role.id,
            },
          },
        },
        include: {
          roles: {
            include: { role: true },
          },
        },
      });

      await tx.outboxEvent.create({
        data: {
          sourceId: `user:${user.id}:registered`,
          eventType: "USER_REGISTERED",
          payload: { userId: user.id, email: user.email },
        },
      });
      return user;
    })
    .catch((err: unknown) => {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictError("Email already registered");
      }
      throw err;
    });
}

/**
 * Stores a hashed refresh token in the database.
 *
 * Only the SHA-256 hash is persisted, so a database leak doesn't expose usable tokens.
 * A fast hash is enough here (unlike passwords) because the token is 40 random bytes,
 * not a guessable secret.
 */
export async function createRefreshToken(
  rawToken: string,
  userId: string,
  expiresAt: Date,
) {
  const tokenHash = hashToken(rawToken);
  return prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
    },
  });
}

/**
 * Atomically consumes an old refresh token and issues a new refresh token in a single transaction.
 * Guarantees that concurrent requests using the same old token cannot both succeed.
 *
 * A token that is unknown, revoked or expired is rejected. Reuse of an already-consumed
 * token is rejected too, but this does not revoke the user's other tokens.
 *
 * @returns The token's owner (with roles) so the caller can mint a new access token.
 * @throws {UnauthorizedError} 401 when the token is invalid/expired, the account is
 *   disabled, or the token was consumed by a concurrent request.
 */
export async function rotateRefreshTokenAtomic(
  oldRawToken: string,
  newRawToken: string,
  newExpiresAt: Date,
) {
  const oldHash = hashToken(oldRawToken);
  const newHash = hashToken(newRawToken);

  return prisma.$transaction(async (tx) => {
    // 1. Look up valid, active refresh token
    const storedToken = await tx.refreshToken.findUnique({
      where: { tokenHash: oldHash },
      include: {
        user: {
          include: {
            roles: {
              include: { role: true },
            },
          },
        },
      },
    });

    if (
      !storedToken ||
      storedToken.revokedAt ||
      storedToken.expiresAt <= new Date()
    ) {
      throw new UnauthorizedError("Invalid or expired refresh token");
    }

    // Check account status
    if (storedToken.user.status === "DISABLED") {
      throw new UnauthorizedError("Account has been disabled");
    }

    // 2. Atomically revoke old token
    // The conditional update (still unrevoked and unexpired) is the real guard: if two
    // requests race, only one sees count === 1; the other fails below.
    const now = new Date();
    const consumed = await tx.refreshToken.updateMany({
      where: { id: storedToken.id, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now },
    });
    if (consumed.count !== 1) {
      throw new UnauthorizedError("Refresh token already consumed");
    }

    // 3. Persist new hashed refresh token
    await tx.refreshToken.create({
      data: {
        userId: storedToken.userId,
        tokenHash: newHash,
        expiresAt: newExpiresAt,
      },
    });

    return storedToken.user;
  });
}

/** Revokes the refresh token matching the raw value; unknown tokens are silently ignored. */
export async function revokeRefreshToken(rawToken: string) {
  const tokenHash = hashToken(rawToken);
  return prisma.refreshToken.updateMany({
    where: { tokenHash },
    data: { revokedAt: new Date() },
  });
}

/** Revokes every refresh token of a user, ending all of their sessions. */
export async function revokeAllUserTokens(userId: string) {
  return prisma.refreshToken.updateMany({
    where: { userId },
    data: { revokedAt: new Date() },
  });
}
