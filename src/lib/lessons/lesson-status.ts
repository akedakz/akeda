import type { LessonStatus, LessonStatusOverride } from "@/components/students/student-lesson-types";

export function getLessonStatus(statusOverride: LessonStatusOverride | null, endsAt: string, now = new Date()): LessonStatus {
  if (statusOverride) return statusOverride;
  return now.getTime() < new Date(endsAt).getTime() ? "SCHEDULED" : "ATTENDED";
}

export const lessonStatusLabels: Record<LessonStatus, string> = {
  SCHEDULED: "Запланирован", ATTENDED: "Посещение было", CANCELLED_BY_TEACHER: "Отменён преподавателем", CANCELLED_BY_STUDENT: "Отменён учеником", NO_SHOW: "Не посещён", LATE_CANCELLED: "Поздно отменён",
};
