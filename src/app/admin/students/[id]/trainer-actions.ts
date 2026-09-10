"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";

export type TrainerActionResult = { ok: true; message: string } | { ok: false; message: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function context(studentId: string) {
  const current = await getCurrentProfile();
  if (current?.profile?.role !== "ADMIN" || !uuid.test(studentId)) return null;
  const db = createAdminClient();
  const student = await db.from("profiles").select("id").eq("id", studentId).eq("role", "STUDENT").maybeSingle();
  return !student.error && student.data ? { ownerAdminId: current.profile.id, db } : null;
}

function refresh(studentId: string) { revalidatePath(`/admin/students/${studentId}`); revalidatePath("/student/trainers"); revalidatePath("/student/trainers/quick-problems"); revalidatePath("/student/trainers/theory"); revalidatePath("/student/progress"); }
function rpcStatus(data: unknown) { return (data as { status?: string } | null)?.status ?? "unknown"; }

export async function assignTrainer(studentId: string, trainerId: string): Promise<TrainerActionResult> {
  const ctx = await context(studentId);
  if (!ctx) return { ok: false, message: "Ученик не найден или недостаточно прав." };
  if (!uuid.test(trainerId)) return { ok: false, message: "Некорректный тренажёр." };
  const trainer = await ctx.db.from("trainers").select("id,type,status").eq("id", trainerId).eq("owner_admin_id", ctx.ownerAdminId).in("type", ["QUICK_PROBLEMS", "THEORY"]).maybeSingle();
  if (trainer.error || !trainer.data || trainer.data.type === "THEORY" && trainer.data.status !== "PUBLISHED") return { ok: false, message: "Тренажёр не найден, не опубликован или принадлежит другому администратору." };
  if (trainer.data.type === "THEORY") { const completed = await ctx.db.from("trainer_theory_completion_history").select("id").eq("student_id", studentId).eq("owner_admin_id", ctx.ownerAdminId).eq("source_trainer_id", trainerId).maybeSingle(); if (completed.error || completed.data) return { ok: false, message: completed.data ? "Theory уже завершён учеником." : "Не удалось проверить историю Theory." }; }
  const result = await ctx.db.rpc("assign_trainer_atomic", { p_owner_admin_id: ctx.ownerAdminId, p_student_id: studentId, p_trainer_id: trainerId });
  if (result.error) { console.error("Не удалось назначить тренажёр:", result.error); return { ok: false, message: "Не удалось назначить тренажёр." }; }
  const status = rpcStatus(result.data);
  if (status === "already_assigned") return { ok: false, message: "Этот тренажёр уже назначен ученику." };
  if (status === "already_completed") return { ok: false, message: "Тренажёр уже завершён. Для повторного прохождения используйте «Начать заново»." };
  if (status !== "created") return { ok: false, message: "Назначение отклонено: ученик или тренажёр больше недоступен." };
  refresh(studentId); return { ok: true, message: "Тренажёр назначен." };
}

export async function assignTrainers(studentId: string, trainerType: "QUICK_PROBLEMS" | "THEORY", trainerIds: string[]): Promise<TrainerActionResult> {
  const ctx = await context(studentId);
  if (!ctx || !["QUICK_PROBLEMS", "THEORY"].includes(trainerType) || !Array.isArray(trainerIds)
    || !trainerIds.length || trainerIds.length > 500 || trainerIds.some((id) => typeof id !== "string" || !uuid.test(id))) {
    return { ok: false, message: "Выберите корректные тренажёры." };
  }
  const result = await ctx.db.rpc("assign_trainers_batch_atomic", {
    p_owner_admin_id: ctx.ownerAdminId, p_student_id: studentId,
    p_trainer_type: trainerType, p_trainer_ids: [...new Set(trainerIds)],
  });
  if (result.error || rpcStatus(result.data) !== "assigned") return { ok: false, message: "Не удалось подтвердить назначение тренажёров. Список мог измениться. Попробуйте ещё раз." };
  refresh(studentId);
  return { ok: true, message: "Выбранные тренажёры назначены." };
}

export async function resetTrainerProgress(studentId: string, assignmentId: string): Promise<TrainerActionResult> {
  const ctx = await context(studentId);
  if (!ctx || !uuid.test(assignmentId)) return { ok: false, message: "Некорректное назначение или недостаточно прав." };
  const assignment = await ctx.db.from("trainer_assignments").select("id").eq("id", assignmentId).eq("student_id", studentId).eq("owner_admin_id", ctx.ownerAdminId).maybeSingle();
  if (assignment.error || !assignment.data) return { ok: false, message: "Назначение не найдено." };
  const result = await ctx.db.rpc("reset_trainer_assignment_atomic", { p_owner_admin_id: ctx.ownerAdminId, p_student_id: studentId, p_assignment_id: assignmentId });
  if (result.error || rpcStatus(result.data) !== "reset") { if (result.error) console.error("Не удалось сбросить прогресс тренажёра:", result.error); return { ok: false, message: "Не удалось сбросить прогресс." }; }
  refresh(studentId); return { ok: true, message: "Прогресс сброшен." };
}

export async function removeTrainerAssignment(studentId: string, assignmentId: string): Promise<TrainerActionResult> {
  const ctx = await context(studentId);
  if (!ctx || !uuid.test(assignmentId)) return { ok: false, message: "Некорректное назначение или недостаточно прав." };
  const result = await ctx.db.from("trainer_assignments").delete().eq("id", assignmentId).eq("student_id", studentId).eq("owner_admin_id", ctx.ownerAdminId).select("id").maybeSingle();
  if (result.error || !result.data) { if (result.error) console.error("Не удалось удалить назначение тренажёра:", result.error); return { ok: false, message: "Назначение не найдено или уже удалено." }; }
  refresh(studentId); return { ok: true, message: "Назначение удалено." };
}

export async function restartCompletedTrainer(studentId: string, completionId: string): Promise<TrainerActionResult> {
  const ctx = await context(studentId);
  if (!ctx || !uuid.test(completionId)) return { ok: false, message: "Некорректный результат или недостаточно прав." };
  const completion = await ctx.db.from("trainer_completion_history").select("id,source_trainer_id").eq("id", completionId).eq("student_id", studentId).eq("owner_admin_id", ctx.ownerAdminId).maybeSingle();
  if (completion.error || !completion.data) return { ok: false, message: "Завершённый результат не найден." };
  if (!completion.data.source_trainer_id) return { ok: false, message: "Исходный тренажёр удалён. Начать заново невозможно." };
  const trainer = await ctx.db.from("trainers").select("id").eq("id", completion.data.source_trainer_id).eq("owner_admin_id", ctx.ownerAdminId).maybeSingle();
  if (trainer.error || !trainer.data) return { ok: false, message: "Исходный тренажёр удалён. История сохранена, но перезапуск невозможен." };
  const result = await ctx.db.rpc("restart_completed_trainer_atomic", { p_owner_admin_id: ctx.ownerAdminId, p_student_id: studentId, p_completion_id: completionId });
  if (result.error) { console.error("Не удалось перезапустить тренажёр:", result.error); return { ok: false, message: "Не удалось начать тренажёр заново." }; }
  const status = rpcStatus(result.data);
  if (status === "already_assigned") return { ok: false, message: "У ученика уже есть активное назначение этого тренажёра." };
  if (status === "trainer_not_found") return { ok: false, message: "Исходный тренажёр удалён. История сохранена." };
  if (status !== "restarted") return { ok: false, message: "Завершённый результат изменился. Обновите страницу." };
  refresh(studentId); return { ok: true, message: "Тренажёр назначен заново с прогрессом 0%." };
}

export async function restartCompletedTheoryTrainer(studentId: string, completionId: string): Promise<TrainerActionResult> {
  const ctx = await context(studentId);
  if (!ctx || !uuid.test(completionId)) return { ok: false, message: "Некорректный результат или недостаточно прав." };
  const result = await ctx.db.rpc("restart_completed_theory_trainer_atomic", { p_owner_admin_id: ctx.ownerAdminId, p_student_id: studentId, p_completion_id: completionId });
  if (result.error) { console.error("Не удалось перезапустить Theory:", result.error); return { ok: false, message: "Не удалось начать Theory заново." }; }
  const status = rpcStatus(result.data);
  if (status === "already_assigned") return { ok: false, message: "У ученика уже есть активное назначение этого Theory." };
  if (status === "trainer_not_found") return { ok: false, message: "Исходный Theory удалён. Завершённый результат сохранён." };
  if (status === "trainer_not_published") return { ok: false, message: "Theory сейчас не опубликован. Завершённый результат сохранён." };
  if (status !== "restarted") return { ok: false, message: "Завершённый результат изменился. Обновите страницу." };
  refresh(studentId); return { ok: true, message: "Theory назначен заново с прогрессом 0%." };
}

export async function deleteCompletedTrainerResult(studentId: string, completionId: string, trainerType: "QUICK_PROBLEMS" | "THEORY"): Promise<TrainerActionResult> {
  const ctx = await context(studentId);
  if (!ctx || !uuid.test(completionId) || !["QUICK_PROBLEMS", "THEORY"].includes(trainerType)) return { ok: false, message: "Некорректный результат или недостаточно прав." };
  const result = await ctx.db.rpc("delete_completed_trainer_result_atomic", { p_owner_admin_id: ctx.ownerAdminId, p_student_id: studentId, p_completion_id: completionId, p_trainer_type: trainerType });
  if (result.error) { console.error("Не удалось удалить результат тренажёра:", result.error); return { ok: false, message: "Не удалось удалить результат." }; }
  if (rpcStatus(result.data) !== "deleted") return { ok: false, message: "Результат уже удалён или недоступен." };
  refresh(studentId); return { ok: true, message: "Завершённый результат удалён." };
}
