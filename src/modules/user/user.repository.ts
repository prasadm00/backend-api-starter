import { prisma } from "../../config/prisma.js";

/*
 * User repository (database layer: routes -> controller -> service -> repository).
 */

/**
 * Loads a user's profile fields and role names.
 *
 * Uses `select` so only the listed fields are fetched; nothing beyond them
 * (e.g. credentials) is read from the user row.
 *
 * @returns The user with nested `roles`, or `null` when not found.
 */

export async function findUserProfileById(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      roles: {
        select: {
          role: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });
}
