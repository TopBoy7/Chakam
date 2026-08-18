export type UserRole = 'student' | 'lecturer' | 'admin' | 'pending';
export type UserStatus = 'active' | 'suspended';

export interface User {
  email: string;
  role: UserRole;
  status: UserStatus;
  matricNumber: string | null;
  staffId: string | null;
  fullName: string;
  emailVerifiedAt: string;
  createdAt: string;
  lastLoginAt: string | null;
}
