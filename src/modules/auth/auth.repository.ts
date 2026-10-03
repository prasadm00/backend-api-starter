import { prisma } from "../../config/prisma";
import { type RegisterInput } from "./auth.types";
import { ConflictError } from "../../errors/AppError";
import argon2 from "argon2";
import { logger } from "../../common/logger";

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
    include: {
      roles: {
        include: { role: true },
      },
    },
  });
}

export async function createUser(data: RegisterInput & { password: string }) {
  // Get or create default USER role
  let role = await prisma.role.findUnique({
    where: { name: "USER" },
  });

  if (!role) {
    role = await prisma.role.create({
      data: { name: "USER" },
    });
  }

  // Create user with role in a transaction
  return prisma.$transaction(async (tx) => {
    // Check if email already exists
    const existingUser = await tx.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new ConflictError("Email already registered");
    }

    // Hash password
    const passwordHash = await argon2.hash(data.password);

    // Create user
    const user = await tx.user.create({
      data: {
        email: data.email,
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

    return user;
  });
}

export async function getUserWithRoles(userId: string) {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    include: {
      roles: true,
      // userRoles:{
      //   include:{
      //     role:true
      //   }
      // }
    },
  });
  return user;
}

export async function createRefreshToken(
  token: string,
  userId: string,
  expiresAt: any,
) {
  const data = await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: token,
      expiresAt: expiresAt,
    },
  });
  logger.info(data,"Tokendata")

  return data
}
export async function findRefreshToken(token: string) {
  return prisma.refreshToken.findFirst({
    where: {
      tokenHash: token,
      revokedAt: null,
      expiresAt: {
        gt: new Date(),
      },
    },
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
}

export async function revokeRefreshToken(token: string) {
  return prisma.refreshToken.updateMany({
    where: { tokenHash: token },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserTokens(userId: string) {
  return prisma.refreshToken.updateMany({
    where: { userId },
    data: { revokedAt: new Date() },
  });
}