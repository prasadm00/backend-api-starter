/** Shape of the profile returned by GET /users/me; `roles` holds role names. */
export interface UserProfileResponse {
  id: string;
  email: string;
  status: string;
  roles: string[];
  createdAt: Date;
  updatedAt: Date;
}
