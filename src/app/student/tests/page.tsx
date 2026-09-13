import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageContent, PageContentLoading, PageHeader, PageShell } from "@/components/page-layout/page-layout";
import StudentTestsList from "@/components/student/tests/student-tests-list";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { buildStudentTestSummaries, sortPendingTests } from "@/lib/tests/build-student-test-summaries";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Тесты — AKEDA" };
export default function StudentTestsPage() { return <PageShell><PageHeader title="Тесты" description="Назначенные тесты и результаты."/><PageContent><Suspense fallback={<PageContentLoading label="Загружаем тесты"/>}><TestsContent/></Suspense></PageContent></PageShell>; }
async function TestsContent() {
  const current = await getCurrentProfile(); if (!current) redirect("/login"); if (current.profile?.role !== "STUDENT") redirect("/admin");
  const supabase = await createClient();
  const admin = createAdminClient();
  const assignments = await admin.from("test_assignments").select("id,title,source_test_id,created_at,deadline_at").eq("student_id", current.user.id).order("created_at", { ascending: false });
  if (assignments.error) console.error("Не удалось загрузить тесты ученика:", { code: assignments.error.code, message: assignments.error.message, details: assignments.error.details, hint: assignments.error.hint });
  const ids = (assignments.data ?? []).map((item) => item.id);
  const sourceIds = [...new Set((assignments.data ?? []).map((item) => item.source_test_id).filter((id): id is string => Boolean(id)))];
  const [attempts, questions] = await Promise.all([
    ids.length ? supabase.from("test_attempts").select("id,assignment_id,attempt_number,started_at,submitted_at,score,max_score").eq("student_id", current.user.id).in("assignment_id", ids) : Promise.resolve({ data: [], error: null }),
    sourceIds.length ? admin.from("test_questions").select("id,test_id").in("test_id", sourceIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (attempts.error) console.error("Не удалось загрузить попытки ученика:", { code: attempts.error.code, message: attempts.error.message, details: attempts.error.details, hint: attempts.error.hint });
  if (questions.error) console.warn("STUDENT_TEST_QUESTION_COUNTS", { code: questions.error.code || null, message: questions.error.message || "Unknown Supabase error", details: questions.error.details || null, hint: questions.error.hint || null });
  const questionCounts = new Map<string, number>();
  for (const question of questions.data ?? []) questionCounts.set(question.test_id, (questionCounts.get(question.test_id) ?? 0) + 1);
  const lightweightAssignments = (assignments.data ?? []).map((item) => ({ ...item, question_count: questions.error ? -1 : item.source_test_id ? questionCounts.get(item.source_test_id) ?? 0 : 0 }));
  const summaries = buildStudentTestSummaries(lightweightAssignments, attempts.data ?? []);
  return <StudentTestsList pending={sortPendingTests(summaries.filter((item) => !item.completed))} completed={summaries.filter((item) => item.completed).sort((a, b) => Date.parse(b.lastSubmittedAt ?? b.createdAt) - Date.parse(a.lastSubmittedAt ?? a.createdAt))}/>;
}
