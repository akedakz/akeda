import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageContent, PageContentLoading, PageHeader, PageShell } from "@/components/page-layout/page-layout";
import StudentDashboard from "@/components/student/student-dashboard";
import type { StudentDashboardData, StudentPendingTest } from "@/components/student/student-dashboard-types";
import type { LessonStatusOverride } from "@/components/students/student-lesson-types";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { almatyDate } from "@/lib/lessons/lesson-generation";
import { getLessonStatus } from "@/lib/lessons/lesson-status";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import styles from "./student.module.css";
import { createStudentAvatarUrl } from "@/lib/avatars/student-avatar";

export const metadata: Metadata = { title: "Главная — кабинет ученика NSP", description: "Расписание, тесты и последние уроки." };
type AssignmentRow = { id: string; title: string; deadline_at: string | null; created_at: string };
type AttemptRow = { id: string; assignment_id: string; submitted_at: string | null; score: number | null; max_score: number | null };
type LessonRow = { id: string; starts_at: string; ends_at: string; status_override: LessonStatusOverride | null };

export default function StudentPage() { return <PageShell><PageHeader title="Главная" description="Расписание, назначенные тесты и последние уроки."/><PageContent><Suspense fallback={<PageContentLoading label="Загружаем главную"/>}><DashboardContent/></Suspense></PageContent></PageShell>; }
async function DashboardContent() {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (current.profile?.role === "ADMIN") redirect("/admin");
  if (current.profile?.role !== "STUDENT") redirect("/dashboard");
  if (current.profile.student_status !== "ACTIVE") return null;
  const studentId = current.user.id;
  const supabase = await createClient();
  const admin = createAdminClient();
  const now = new Date();
  const today = almatyDate(now);
  const [nextLessonResult, scheduleResult, assignmentsResult, lessonsResult] = await Promise.all([
    supabase.from("student_lessons").select("id, starts_at, ends_at, status_override").eq("student_id", studentId).is("deleted_at", null).gt("ends_at", now.toISOString()).or("status_override.is.null,status_override.not.in.(CANCELLED_BY_TEACHER,CANCELLED_BY_STUDENT)").order("starts_at").limit(1).maybeSingle(),
    supabase.from("student_schedule_slots").select("id, weekday, start_time, duration_minutes").eq("student_id", studentId).lte("valid_from", today).or(`valid_until.is.null,valid_until.gte.${today}`).order("weekday").order("start_time"),
    admin.from("test_assignments").select("id, title, deadline_at, created_at").eq("student_id", studentId),
    supabase.from("student_lessons").select("id, starts_at, ends_at, status_override").eq("student_id", studentId).is("deleted_at", null).lte("ends_at", now.toISOString()).order("ends_at", { ascending: false }).limit(5),
  ]);
  const baseError = nextLessonResult.error ?? scheduleResult.error ?? assignmentsResult.error ?? lessonsResult.error;
  if (baseError) console.error("Не удалось загрузить главную ученика:", { code: baseError.code, message: baseError.message, details: baseError.details, hint: baseError.hint });
  const assignments = (assignmentsResult.data ?? []) as AssignmentRow[];
  const recentLessons = (lessonsResult.data ?? []) as LessonRow[];
  const [attemptsResult, homeworkResult] = await Promise.all([
    assignments.length ? supabase.from("test_attempts").select("id, assignment_id, submitted_at, score, max_score").eq("student_id", studentId).in("assignment_id", assignments.map((assignment) => assignment.id)) : Promise.resolve({ data: [], error: null }),
    recentLessons.length ? supabase.from("lesson_homework_records").select("lesson_id, title, grade").eq("student_id", studentId).in("lesson_id", recentLessons.map((lesson) => lesson.id)) : Promise.resolve({ data: [], error: null }),
  ]);
  const relatedError = attemptsResult.error ?? homeworkResult.error;
  if (relatedError) console.error("Не удалось загрузить тесты или ДЗ ученика:", { code: relatedError.code, message: relatedError.message, details: relatedError.details, hint: relatedError.hint });
  const attempts = (attemptsResult.data ?? []) as AttemptRow[];
  const attemptsByAssignment = new Map<string, AttemptRow[]>();
  for (const attempt of attempts) attemptsByAssignment.set(attempt.assignment_id, [...(attemptsByAssignment.get(attempt.assignment_id) ?? []), attempt]);
  const tests: StudentPendingTest[] = assignments.flatMap((assignment) => {
    const assignmentAttempts = attemptsByAssignment.get(assignment.id) ?? [];
    const completed = assignmentAttempts.some((attempt) => attempt.submitted_at && attempt.score !== null && attempt.max_score !== null && Number(attempt.max_score) > 0);
    if (completed) return [];
    const active = assignmentAttempts.some((attempt) => !attempt.submitted_at);
    const deadline = assignment.deadline_at ? new Date(assignment.deadline_at) : null;
    const overdue = Boolean(deadline && deadline <= now);
    const urgent = Boolean(deadline && !overdue && deadline.getTime() - now.getTime() < 86400000);
    const action: StudentPendingTest["action"] = active ? overdue ? "EXPIRED" : "CONTINUE" : overdue ? "EXPIRED" : "START";
    return [{ id: assignment.id, title: assignment.title, deadlineAt: assignment.deadline_at, action, urgent, overdue }];
  }).sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.deadlineAt && b.deadlineAt) return Date.parse(a.deadlineAt) - Date.parse(b.deadlineAt);
    if (a.deadlineAt !== b.deadlineAt) return a.deadlineAt ? -1 : 1;
    const sourceA = assignments.find((assignment) => assignment.id === a.id)!, sourceB = assignments.find((assignment) => assignment.id === b.id)!;
    return Date.parse(sourceA.created_at) - Date.parse(sourceB.created_at);
  }).slice(0, 3);
  const homeworkMap = new Map((homeworkResult.data ?? []).map((homework) => [homework.lesson_id, { title: homework.title, grade: homework.grade }]));
  const name = current.profile.full_name?.trim().split(/\s+/)[0] || "ученик";
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Almaty", hour: "2-digit", hourCycle: "h23" }).format(now));
  const nextLesson = nextLessonResult.data as LessonRow | null;
  const data: StudentDashboardData = {
    avatarUrl: await createStudentAvatarUrl(current.profile.avatar_path),
    fullName: current.profile.full_name ?? "Ученик",
    firstName: name,
    greeting: hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер",
    dateLabel: new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now),
    nextLesson: nextLesson ? { startsAt: nextLesson.starts_at, endsAt: nextLesson.ends_at, happeningNow: new Date(nextLesson.starts_at) <= now } : null,
    schedule: (scheduleResult.data ?? []).map((slot) => ({ id: slot.id, weekday: slot.weekday, startTime: slot.start_time, durationMinutes: slot.duration_minutes })),
    tests,
    lessons: recentLessons.map((lesson) => ({ id: lesson.id, startsAt: lesson.starts_at, endsAt: lesson.ends_at, status: getLessonStatus(lesson.status_override, lesson.ends_at, now), homework: homeworkMap.get(lesson.id) ?? null })),
  };
  return <><StudentDashboard data={data}/>{(baseError || relatedError) && process.env.NODE_ENV === "development" && <p className={styles.devError}>Часть данных кабинета не загрузилась. Подробности записаны на сервере.</p>}</>;
}
