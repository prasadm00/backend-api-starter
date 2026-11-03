import { findUserProfileById } from "./user.repository.js";
import { NotFoundError, UnauthorizedError } from "../../errors/AppError.js";

export async function getUserProfile(userId: string) {
  if (!userId) {
    throw new UnauthorizedError("User identifier missing");
  }

  const user = await findUserProfileById(userId);
  if (!user) {
    throw new NotFoundError("User not found");
  }

  if (user.status === "DISABLED") {
    throw new UnauthorizedError("Account has been disabled");
  }

  return {
    id: user.id,
    email: user.email,
    status: user.status,
    roles: user.roles.map((r) => r.role.name),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
