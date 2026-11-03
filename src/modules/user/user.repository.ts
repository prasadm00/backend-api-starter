import { prisma } from "../../config/prisma.js";

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
