export type UserRole = "ADMIN" | "STUDENT" | "PARENT";
export type StudentStatus = "ACTIVE" | "PAUSED" | "ARCHIVED";

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: UserRole;
  student_status: StudentStatus | null;
  parent_id: string | null;
  avatar_path: string | null;
  avatar_updated_at: string | null;
};
