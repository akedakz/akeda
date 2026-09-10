export type UserRole = "ADMIN" | "STUDENT";
export type StudentStatus = "ACTIVE" | "PAUSED" | "ARCHIVED";

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: UserRole;
  student_status: StudentStatus | null;
  avatar_path: string | null;
  avatar_updated_at: string | null;
};
