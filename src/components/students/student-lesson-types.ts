export type LessonStatusOverride = "CANCELLED_BY_TEACHER" | "CANCELLED_BY_STUDENT" | "NO_SHOW" | "LATE_CANCELLED";
export type LessonStatus = "SCHEDULED" | "ATTENDED" | LessonStatusOverride;
export type ScheduleSlot = { id: string; weekday: number; startTime: string; durationMinutes: number; validFrom: string };
export type HomeworkRecord = { title: string; grade: number | null; comment: string | null };
export type StudentLesson = { id: string; scheduleSlotId: string | null; startsAt: string; endsAt: string; statusOverride: LessonStatusOverride | null; status: LessonStatus; homework: HomeworkRecord | null };
export type LessonActionResult = { ok: boolean; message: string };
export type ScheduleInput = { weekday: number; startTime: string; durationMinutes: number };
