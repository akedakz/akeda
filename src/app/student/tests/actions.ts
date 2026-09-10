"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { isStudentAnswer } from "@/lib/tests/grade-student-attempt";
import type { TestSnapshot } from "@/lib/tests/test-snapshot-types";
import { createAdminClient } from "@/lib/supabase/admin";
import { answerConflictMessage, interpretAnswerSaveResult, type AnswerSaveResult } from "@/lib/tests/answer-autosave";
import type { StudentAnswer } from "@/lib/tests/student-test-types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type DeadlineFinalizeRpcResult = { status: "finalized" | "already_submitted" | "too_early" | "not_found"; retry_after_ms?: number };
function isSnapshot(value: unknown): value is TestSnapshot { const snapshot = value as Partial<TestSnapshot> | null; return Boolean(snapshot && (snapshot.version === 1 || snapshot.version === 2) && Array.isArray(snapshot.questions)); }
async function studentContext() { const current = await getCurrentProfile(); return current?.profile?.role === "STUDENT" && current.profile.student_status === "ACTIVE" ? { studentId: current.user.id, admin: createAdminClient() } : null; }
function log(label: string, error: { code?: string; message: string; details?: string; hint?: string }) { console.error(label, { code: error.code, message: error.message, details: error.details, hint: error.hint }); }
function isRpcConflict(error: { message: string }, code: string) { return error.message.includes(code); }
type RpcResult<T> = { data: T; error: { code?: string; message: string; details?: string; hint?: string } | null };
function isMistakeImageLockConflict(error: RpcResult<unknown>["error"]) { return error?.code === "40001" && error.message.includes("MISTAKE_IMAGE_LOCK_BUSY"); }
async function withMistakeImageLockRetry<T>(operation: () => PromiseLike<RpcResult<T>>) {
  let result = await operation();
  if (isMistakeImageLockConflict(result.error)) result = await operation();
  return result;
}

export async function saveTestAnswer(attemptId: string, questionKey: string, answer: unknown, version: { expectedRevision: number }): Promise<AnswerSaveResult> {
  const operation = crypto.randomUUID();
  const context = await studentContext();
  if (!context) return { ok: false, message: "Сессия истекла. Войдите снова." };
  // Reject pre-deployment callers that still send a locally incremented number.
  if (!version || typeof version !== "object") return { ok: false, message: "Обновите страницу, чтобы продолжить сохранение ответов." };
  const expectedRevision = version.expectedRevision;
  if (!uuid.test(attemptId) || !questionKey || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) return { ok: false, message: "Некорректный ответ." };
  const attempt = await context.admin.from("test_attempts").select("id, assignment_id, submitted_at").eq("id", attemptId).eq("student_id", context.studentId).maybeSingle();
  if (attempt.error || !attempt.data || attempt.data.submitted_at) return { ok: false, message: "Это назначение больше недоступно." };
  const assignment = await context.admin.from("test_assignments").select("snapshot").eq("id", attempt.data.assignment_id).eq("student_id", context.studentId).maybeSingle();
  if (assignment.error || !assignment.data || !isSnapshot(assignment.data.snapshot)) return { ok: false, message: "Тест недоступен." };
  const question = assignment.data.snapshot.questions.find((item) => item.key === questionKey);
  if (!question || !isStudentAnswer(answer, question)) return { ok: false, message: "Ответ имеет неверный формат." };
  const saved = await withMistakeImageLockRetry(() => context.admin.rpc("save_student_test_answer_checked", { p_attempt_id: attemptId, p_question_key: questionKey, p_answer: answer, p_expected_revision: expectedRevision }));
  if (saved.error) { console.error("TEST_ANSWER_SAVE", { operation }); return { ok: false, message: "Не удалось сохранить ответ." }; }
  return interpretAnswerSaveResult(saved.data);
}

export async function finalizeExpiredTestAttempt(attemptId: string, assignmentId: string): Promise<{ finalized: boolean; retryAfterMs?: number }> {
  const context = await studentContext();
  if (!context || !uuid.test(attemptId) || !uuid.test(assignmentId)) return { finalized: false };
  const attempt = await context.admin.from("test_attempts").select("id").eq("id", attemptId).eq("assignment_id", assignmentId).eq("student_id", context.studentId).maybeSingle();
  if (attempt.error || !attempt.data) return { finalized: false };
  const result = await withMistakeImageLockRetry(() => context.admin.rpc("finalize_student_test_attempt_if_expired", { p_attempt_id: attemptId }));
  if (result.error) { log("Не удалось завершить попытку по дедлайну:", result.error); return { finalized: false }; }
  const finalized = result.data as DeadlineFinalizeRpcResult | null;
  if (finalized?.status === "too_early") return { finalized: false, retryAfterMs: Math.max(50, Number(finalized.retry_after_ms) || 50) };
  if (finalized?.status === "finalized" || finalized?.status === "already_submitted") {
    revalidatePath("/student"); revalidatePath("/student/tests"); revalidatePath("/student/progress"); revalidatePath(`/student/tests/${assignmentId}`);
    return { finalized: true };
  }
  return { finalized: false };
}

export async function submitTestAttempt(attemptId: string, assignmentId: string, answers: Record<string, StudentAnswer>): Promise<{ ok: false; status?: "conflict"; message: string }> {
  const operation = crypto.randomUUID();
  const context = await studentContext();
  if (!context || !uuid.test(attemptId) || !uuid.test(assignmentId)) redirect("/student/tests");
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return { ok: false, message: "Не удалось проверить сохранённые ответы." };
  const attempt = await context.admin.from("test_attempts").select("id, assignment_id, submitted_at").eq("id", attemptId).eq("student_id", context.studentId).maybeSingle();
  if (attempt.error || !attempt.data || attempt.data.assignment_id !== assignmentId) redirect(`/student/tests/${assignmentId}/attempts/${attemptId}`);
  if (attempt.data.submitted_at) redirect(`/student/tests/${attempt.data.assignment_id}/attempts/${attemptId}`);
  const submitted = await withMistakeImageLockRetry(() => context.admin.rpc("submit_student_test_attempt_checked", { p_attempt_id: attemptId, p_answers: answers }));
  if (submitted.error) {
    if (isRpcConflict(submitted.error, "TEST_ATTEMPT_ALREADY_SUBMITTED")) redirect(`/student/tests/${attempt.data.assignment_id}/attempts/${attemptId}`);
    console.error("TEST_SUBMIT_FINALIZE", { operation });
    redirect(`/student/tests/${attempt.data.assignment_id}/attempts/${attemptId}`);
  }
  const status = (submitted.data as { status?: string } | null)?.status;
  if (status === "conflict") return { ok: false, status: "conflict", message: answerConflictMessage };
  if (status !== "submitted" && status !== "already_submitted") return { ok: false, message: "Не удалось подтвердить отправку ответов." };
  revalidatePath("/student"); revalidatePath("/student/tests"); revalidatePath("/student/progress"); revalidatePath(`/student/tests/${attempt.data.assignment_id}`);
  redirect(`/student/tests/${attempt.data.assignment_id}/attempts/${attemptId}`);
}
