import { findUserProfileById } from "./user.repository.js";
import { NotFoundError, UnauthorizedError } from "../../errors/AppError.js";

/*
 * User business rules (routes -> controller -> service -> repository):
 * turns a stored user into the profile returned by the API.
 */

/**
 * Returns the profile of the given user, with roles flattened to a list of names.
 *
 * @throws {UnauthorizedError} 401 when the id is missing or the account is DISABLED.
 * @throws {NotFoundError} 404 when the user no longer exists.
 */

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
