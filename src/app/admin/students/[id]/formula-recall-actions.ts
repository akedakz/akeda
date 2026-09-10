"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type FormulaRecallAssignmentActionResult = { ok: boolean; message: string };

async function context(studentId: string) {
  const current = await getCurrentProfile();
  if (current?.profile?.role !== "ADMIN" || !uuid.test(studentId)) return null;
  const db = createAdminClient();
  const student = await db.from("profiles").select("id").eq("id", studentId).eq("role", "STUDENT").maybeSingle();
  return student.data && !student.error ? { db, ownerAdminId: current.profile.id } : null;
}

function refresh(studentId: string) {
  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath("/student/trainers");
  revalidatePath("/student/trainers/formula-recall");
}

export async function assignFormulaRecallFormulas(studentId: string, formulaIds: string[]): Promise<FormulaRecallAssignmentActionResult> {
  const ctx = await context(studentId);
  if (!Array.isArray(formulaIds) || formulaIds.length > 500 || formulaIds.some((id) => typeof id !== "string")) return { ok: false, message: "Выберите корректные формулы." };
  const ids = [...new Set(formulaIds)];
  if (!ctx || !ids.length || ids.length > 500 || ids.some((id) => !uuid.test(id))) return { ok: false, message: "Выберите корректные формулы." };
  const result = await ctx.db.rpc("assign_formula_recall_formulas_atomic", { p_owner_admin_id: ctx.ownerAdminId, p_student_id: studentId, p_formula_ids: ids });
  const data = result.data as { status?: string; inserted?: number } | null;
  if (result.error || data?.status !== "assigned") return { ok: false, message: "Не удалось назначить формулы. Проверьте Phase 4 migration." };
  refresh(studentId);
  return { ok: true, message: data.inserted ? `Назначено формул: ${data.inserted}.` : "Все выбранные формулы уже назначены." };
}

export async function unassignFormulaRecallFormula(studentId: string, assignmentId: string): Promise<FormulaRecallAssignmentActionResult> {
  const ctx = await context(studentId);
  if (!ctx || !uuid.test(assignmentId)) return { ok: false, message: "Назначение недоступно." };
  const result = await ctx.db.rpc("unassign_formula_recall_formula_atomic", { p_owner_admin_id: ctx.ownerAdminId, p_student_id: studentId, p_student_formula_id: assignmentId });
  if (result.error || (result.data as { status?: string } | null)?.status !== "unassigned") return { ok: false, message: "Не удалось убрать формулу." };
  refresh(studentId);
  return { ok: true, message: "Формула убрана из Formula Recall." };
}

export async function unassignFormulaRecallFormulas(studentId: string, assignmentIds: string[]): Promise<FormulaRecallAssignmentActionResult> {
  const ctx = await context(studentId);
  if (!ctx || !Array.isArray(assignmentIds) || !assignmentIds.length || assignmentIds.length > 500
    || assignmentIds.some((id) => typeof id !== "string" || !uuid.test(id))) return { ok: false, message: "Выберите корректные назначения." };
  const result = await ctx.db.rpc("unassign_formula_recall_formulas_batch_atomic", {
    p_owner_admin_id: ctx.ownerAdminId, p_student_id: studentId, p_assignment_ids: [...new Set(assignmentIds)],
  });
  if (result.error || (result.data as { status?: string } | null)?.status !== "unassigned") return { ok: false, message: "Не удалось отменить назначения. Попробуйте ещё раз." };
  refresh(studentId);
  return { ok: true, message: "Выбранные назначения отменены." };
}
