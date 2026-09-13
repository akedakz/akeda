import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContent, PageContentLoading, PageHeader, PageShell } from "@/components/page-layout/page-layout";
import OverviewDashboard from "@/components/admin/overview-dashboard";
import type { OverviewData, OverviewLesson, RecentTestResult } from "@/components/admin/overview-types";
import type { HomeworkRecord, LessonStatusOverride } from "@/components/students/student-lesson-types";
import { addCalendarDays, almatyDate, almatyLocalToUtc } from "@/lib/lessons/lesson-generation";
import { getLessonStatus } from "@/lib/lessons/lesson-status";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Обзор — AKEDA", description: "Панель текущего дня." };

type LessonRow = { id: string; student_id: string; starts_at: string; ends_at: string; status_override: LessonStatusOverride | null };
type AttemptRow = { assignment_id: string; student_id: string; attempt_number: number; submitted_at: string; score: number; max_score: number };
type TopicRow = { id: string; student_id: string; title: string; sort_order: number; completed_at: string | null };

export default function AdminPage() { return <PageShell><PageHeader title="Обзор" description="Расписание и показатели текущего дня."/><PageContent><Suspense fallback={<PageContentLoading label="Загружаем обзор"/>}><OverviewContent/></Suspense></PageContent></PageShell>; }
async function OverviewContent() {
  const admin = createAdminClient();
  const now = new Date();
  const today = almatyDate(now);
  const dayStart = almatyLocalToUtc(today, "00:00");
  const dayEnd = almatyLocalToUtc(addCalendarDays(today, 1), "00:00");
  const [lessonResult, recentAttemptResult] = await Promise.all([
    admin.from("student_lessons").select("id, student_id, starts_at, ends_at, status_override").is("deleted_at", null).gte("starts_at", dayStart.toISOString()).lt("starts_at", dayEnd.toISOString()).order("starts_at"),
    admin.from("test_attempts").select("assignment_id, student_id, attempt_number, submitted_at, score, max_score").not("submitted_at", "is", null).not("score", "is", null).not("max_score", "is", null).gt("max_score", 0).order("submitted_at", { ascending: false }).limit(3),
  ]);
  const initialError = lessonResult.error ?? recentAttemptResult.error;
  let loadError: string | undefined;
  if (initialError) {
    console.error("Не удалось загрузить Overview:", { code: initialError.code, message: initialError.message, details: initialError.details, hint: initialError.hint });
    loadError = "Не удалось загрузить данные обзора.";
  }
  const lessonRows = (lessonResult.data ?? []) as LessonRow[];
  const attemptRows = (recentAttemptResult.data ?? []) as AttemptRow[];
  const lessonStudentIds = [...new Set(lessonRows.map((lesson) => lesson.student_id))];
  const allStudentIds = [...new Set([...lessonStudentIds, ...attemptRows.map((attempt) => attempt.student_id)])];
  const lessonIds = lessonRows.map((lesson) => lesson.id);
  const assignmentIds = [...new Set(attemptRows.map((attempt) => attempt.assignment_id))];
  const empty = Promise.resolve({ data: [], error: null });
  const [profilesResult, homeworkResult, topicsResult, assignmentsResult] = await Promise.all([
    allStudentIds.length ? admin.from("profiles").select("id, full_name").in("id", allStudentIds).eq("role", "STUDENT") : empty,
    lessonIds.length ? admin.from("lesson_homework_records").select("lesson_id, title, grade, comment").in("lesson_id", lessonIds) : empty,
    lessonStudentIds.length ? admin.from("student_topics").select("id, student_id, title, sort_order, completed_at").in("student_id", lessonStudentIds).order("student_id").order("sort_order") : empty,
    assignmentIds.length ? admin.from("test_assignments").select("id, title").in("id", assignmentIds) : empty,
  ]);
  const relatedError = profilesResult.error ?? homeworkResult.error ?? topicsResult.error ?? assignmentsResult.error;
  if (relatedError) {
    console.error("Не удалось загрузить связанные данные Overview:", { code: relatedError.code, message: relatedError.message, details: relatedError.details, hint: relatedError.hint });
    loadError = "Не удалось загрузить связанные данные обзора.";
  }
  const profileMap = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile.full_name ?? "Без имени"]));
  const homeworkMap = new Map<string, HomeworkRecord>((homeworkResult.data ?? []).map((record) => [record.lesson_id, { title: record.title, grade: record.grade, comment: record.comment }]));
  const topicsByStudent = new Map<string, TopicRow[]>();
  for (const topic of (topicsResult.data ?? []) as TopicRow[]) topicsByStudent.set(topic.student_id, [...(topicsByStudent.get(topic.student_id) ?? []), topic]);
  const convertLesson = (lesson: LessonRow): OverviewLesson => {
    const topics = topicsByStudent.get(lesson.student_id) ?? [];
    const currentTopic = topics.find((topic) => topic.completed_at === null) ?? null;
    return {
      id: lesson.id,
      studentId: lesson.student_id,
      studentName: profileMap.get(lesson.student_id) ?? "Ученик",
      startsAt: lesson.starts_at,
      endsAt: lesson.ends_at,
      statusOverride: lesson.status_override,
      status: getLessonStatus(lesson.status_override, lesson.ends_at, now),
      homework: homeworkMap.get(lesson.id) ?? null,
      topic: currentTopic ? { id: currentTopic.id, title: currentTopic.title } : null,
      topicState: currentTopic ? "CURRENT" : topics.length ? "COMPLETED" : "EMPTY",
    };
  };
  const lessons = lessonRows.map(convertLesson);
  const scheduled = lessons.filter((lesson) => new Date(lesson.endsAt) > now).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const completed = lessons.filter((lesson) => new Date(lesson.endsAt) <= now).sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  const assignmentMap = new Map((assignmentsResult.data ?? []).map((assignment) => [assignment.id, assignment.title]));
  const recentResults: RecentTestResult[] = attemptRows.flatMap((attempt) => {
    const title = assignmentMap.get(attempt.assignment_id);
    const score = Number(attempt.score), maxScore = Number(attempt.max_score);
    return title && maxScore > 0 ? [{ assignmentId: attempt.assignment_id, studentId: attempt.student_id, studentName: profileMap.get(attempt.student_id) ?? "Ученик", title, score, maxScore, percent: score / maxScore * 100, submittedAt: attempt.submitted_at, attemptNumber: attempt.attempt_number }] : [];
  });
  const data: OverviewData = {
    dateLabel: new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "long", year: "numeric", weekday: "long" }).format(now),
    counters: {
      total: lessons.length,
      held: completed.filter((lesson) => lesson.status === "ATTENDED").length,
      remaining: scheduled.filter((lesson) => !lesson.status.startsWith("CANCELLED_")).length,
      manualReview: 0,
    },
    scheduled,
    completed,
    recentResults,
  };
  return <OverviewDashboard data={data} loadError={loadError} showHeader={false}/>;
}
