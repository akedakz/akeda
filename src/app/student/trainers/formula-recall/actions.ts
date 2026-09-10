"use server";

import { getTrainerStudentAccess, inactiveTrainerResult } from "@/lib/trainers/student-access";
import { checkFormulaAnswer } from "@/lib/formula-recall/formula-checker";
import { loadFormulaRecallSummary, loadFormulaRecallTask } from "@/lib/formula-recall/runtime-data";
import type { FormulaRecallStudentSummary, FormulaRecallStudentTask } from "@/lib/formula-recall/runtime-types";
import { createAdminClient } from "@/lib/supabase/admin";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type RuntimeResult = { ok: boolean; status: string; message: string; task?: FormulaRecallStudentTask; summary?: FormulaRecallStudentSummary };

async function studentContext() {
  const access = await getTrainerStudentAccess();
  return access.ok ? { ...access, db: createAdminClient() } : access;
}

async function response(studentId: string, status: string, taskId?: string, message = "") : Promise<RuntimeResult> {
  const [task, summary] = await Promise.all([taskId ? loadFormulaRecallTask(studentId, taskId) : Promise.resolve(null), loadFormulaRecallSummary(studentId)]);
  return { ok: status !== "error", status, message, task: task ?? undefined, summary: summary.summary };
}

export async function getFormulaRecallTask(topicId: string | null, advance = false): Promise<RuntimeResult> {
  const ctx = await studentContext();
  if (!ctx.ok) return ctx;
  if (!ctx || (topicId !== null && !uuid.test(topicId))) return { ok: false, status: "error", message: "Тренировка недоступна." };
  const result = await ctx.db.rpc("issue_formula_recall_task_atomic", { p_student_id: ctx.studentId, p_topic_id: topicId, p_advance: advance });
  if (result.error) return { ok: false, status: "error", message: "Не удалось открыть тренировку. Проверьте Phase 4 migration." };
  const data = result.data as { status?: string; task_id?: string } | null;
  if (data?.status === "student_inactive") return inactiveTrainerResult();
  if ((data?.status === "issued" || data?.status === "resumed") && data.task_id) return response(ctx.studentId, data.status, data.task_id);
  if (data?.status === "complete") return response(ctx.studentId, "complete", undefined, "Все формулы в выбранной тренировке освоены.");
  if (data?.status === "empty") return response(ctx.studentId, "empty", undefined, "Формулы пока не назначены.");
  return { ok: false, status: "error", message: "Сейчас нельзя выдать следующую задачу." };
}

export async function submitFormulaRecallAnswer(taskId: string, studentExpression: string): Promise<RuntimeResult> {
  const ctx = await studentContext();
  if (!ctx.ok) return ctx;
  if (!ctx || !uuid.test(taskId) || typeof studentExpression !== "string" || studentExpression.length > 250) return { ok: false, status: "error", message: "Ответ некорректен." };
  const taskResult = await ctx.db.from("formula_recall_tasks").select("state,canonical_expression_snapshot,alternative_expressions_snapshot").eq("id", taskId).eq("student_id", ctx.studentId).neq("state", "DONE").maybeSingle();
  if (taskResult.error || !taskResult.data) return { ok: false, status: "error", message: "Задача устарела или больше недоступна." };
  if (!['AWAITING_ANSWER','RETRY_AFTER_HINT'].includes(taskResult.data.state)) return response(ctx.studentId, "unchanged", taskId, "Состояние задачи уже изменилось.");
  const alternatives = Array.isArray(taskResult.data.alternative_expressions_snapshot) ? taskResult.data.alternative_expressions_snapshot.filter((item): item is string => typeof item === "string") : [];
  const checked = checkFormulaAnswer({ studentExpression, canonicalExpression: taskResult.data.canonical_expression_snapshot, alternativeExpressions: alternatives });
  if (!checked.correct && checked.reason !== "not_equivalent") return { ok: false, status: "error", message: checked.reason === "reference_unavailable" ? "Не удалось проверить эту формулу. Сообщите преподавателю." : "Не удалось разобрать запись. Введите полное равенство с помощью редактора формул." };
  const mutation = await ctx.db.rpc("submit_formula_recall_answer_atomic", { p_student_id: ctx.studentId, p_task_id: taskId, p_is_correct: checked.correct });
  if (mutation.error) return { ok: false, status: "error", message: "Не удалось проверить ответ." };
  const data = mutation.data as { status?: string; state?: string; credit_awarded?: boolean } | null;
  if (data?.status === "student_inactive") return inactiveTrainerResult();
  if (data?.status === "revealed" || data?.status === "already_revealed") return response(ctx.studentId, "revealed", taskId, "Неправильно");
  if (data?.status === "correct") return response(ctx.studentId, data.state === "CORRECT_HINTED" ? "correct_hinted" : "correct_clean", taskId, data.credit_awarded ? "Правильно" : "Теперь правильно. Эта формула встретится ещё раз.");
  if (data?.status === "already_completed") return response(ctx.studentId, "unchanged", taskId, "Ответ уже был принят.");
  return { ok: false, status: "error", message: "Переход задачи отклонён." };
}

export async function acknowledgeFormulaRecallHint(taskId: string): Promise<RuntimeResult> {
  const ctx = await studentContext();
  if (!ctx.ok) return ctx;
  if (!ctx || !uuid.test(taskId)) return { ok: false, status: "error", message: "Задача недоступна." };
  const result = await ctx.db.rpc("acknowledge_formula_recall_hint_atomic", { p_student_id: ctx.studentId, p_task_id: taskId });
  const status = (result.data as { status?: string } | null)?.status;
  if (status === "student_inactive") return inactiveTrainerResult();
  if (result.error || (status !== "acknowledged" && status !== "already_acknowledged")) return { ok: false, status: "error", message: "Не удалось продолжить задачу." };
  return response(ctx.studentId, "retry_after_hint", taskId);
}
