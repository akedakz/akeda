import type { LessonStatus } from "@/components/students/student-lesson-types";

export type StudentNextLesson = { startsAt: string; endsAt: string; happeningNow: boolean } | null;
export type StudentScheduleSlot = { id: string; weekday: number; startTime: string; durationMinutes: number };
export type StudentPendingTest = { id: string; title: string; deadlineAt: string | null; action: "START" | "CONTINUE" | "EXPIRED"; urgent: boolean; overdue: boolean };
export type StudentRecentLesson = { id: string; startsAt: string; endsAt: string; status: LessonStatus; homework: { title: string; grade: number | null } | null };
export type StudentDashboardData = { avatarUrl: string | null; fullName: string; firstName: string; greeting: string; dateLabel: string; nextLesson: StudentNextLesson; schedule: StudentScheduleSlot[]; tests: StudentPendingTest[]; lessons: StudentRecentLesson[] };
