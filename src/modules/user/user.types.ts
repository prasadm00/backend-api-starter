export interface UserProfileResponse {
  id: string;
  email: string;
  status: string;
  roles: string[];
  createdAt: Date;
  updatedAt: Date;
}
