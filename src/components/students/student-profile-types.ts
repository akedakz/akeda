import type { StudentStatus } from "@/types/profile";

export type StudentProfileView = {
  id: string;
  fullName: string;
  email: string;
  status: StudentStatus | null;
  createdAt: string;
};

export type StudentProfileActionResult = {
  ok: boolean;
  message: string;
  profile?: Pick<StudentProfileView, "fullName" | "email" | "status">;
};
