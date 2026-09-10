import { getCurrentProfile } from "@/lib/auth/get-current-profile";

export const TRAINER_INACTIVE_MESSAGE = "Доступ к тренажёрам приостановлен.";
export const inactiveTrainerResult = () => ({ ok: false as const, status: "student_inactive" as const, message: TRAINER_INACTIVE_MESSAGE });

export async function getTrainerStudentAccess() {
  const current = await getCurrentProfile();
  if (current?.profile?.role !== "STUDENT") return { ok: false as const, status: "forbidden" as const, message: "Тренировка недоступна." };
  if (current.profile.student_status !== "ACTIVE") return inactiveTrainerResult();
  return { ok: true as const, studentId: current.profile.id };
}
