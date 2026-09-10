"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateFormulaRecallDraft } from "@/lib/formula-recall/draft-validation";
import type { FormulaRecallBatchCreateInput, FormulaRecallDraft } from "@/lib/formula-recall/types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type FormulaRecallActionResult = { ok: boolean; message: string; formulaId?: string; contentRevision?: number };
export type FormulaRecallBatchActionResult = { ok: boolean; message: string; formulaIds?: string[]; formulaIndex?: number; field?: string; code?: string };
export type FormulaRecallCheckActionResult = { ok: boolean; correct: boolean; reason: string; message: string };

async function context() {
  const current = await getCurrentProfile();
  return current?.profile?.role === "ADMIN" ? { adminId: current.profile.id, db: createAdminClient() } : null;
}
function rpcStatus(data: unknown) { return data && typeof data === "object" && "status" in data ? String((data as { status: unknown }).status) : ""; }
function refresh(formulaId?: string) {
  revalidatePath("/admin/trainers/formula-recall");
  if (formulaId) {
    revalidatePath(`/admin/trainers/formula-recall/${formulaId}/edit`);
    revalidatePath(`/admin/trainers/formula-recall/${formulaId}/preview`);
  }
}

export async function createFormulaRecallTopic(title: string): Promise<FormulaRecallActionResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, message: "Недостаточно прав." };
  const result = await ctx.db.rpc("create_formula_recall_topic_atomic", { p_owner_admin_id: ctx.adminId, p_title: title });
  const status = rpcStatus(result.data);
  if (result.error) return { ok: false, message: "Не удалось создать тему. Проверьте, что migration применена." };
  if (status === "duplicate") return { ok: false, message: "Тема с таким названием уже существует." };
  if (status !== "created") return { ok: false, message: "Введите название от 1 до 120 символов." };
  refresh(); return { ok: true, message: "Тема создана." };
}

export async function renameFormulaRecallTopic(id: string, title: string): Promise<FormulaRecallActionResult> {
  const ctx = await context();
  if (!ctx || !uuid.test(id)) return { ok: false, message: "Тема недоступна." };
  const result = await ctx.db.rpc("rename_formula_recall_topic_atomic", { p_owner_admin_id: ctx.adminId, p_topic_id: id, p_title: title });
  const status = rpcStatus(result.data);
  if (result.error) return { ok: false, message: "Не удалось переименовать тему." };
  if (status === "duplicate") return { ok: false, message: "Тема с таким названием уже существует." };
  if (status !== "renamed") return { ok: false, message: "Тема недоступна или название некорректно." };
  refresh(); return { ok: true, message: "Тема переименована." };
}

export async function deleteFormulaRecallTopic(id: string): Promise<FormulaRecallActionResult> {
  const ctx = await context();
  if (!ctx || !uuid.test(id)) return { ok: false, message: "Тема недоступна." };
  const result = await ctx.db.rpc("delete_formula_recall_topic_atomic", { p_owner_admin_id: ctx.adminId, p_topic_id: id });
  const status = rpcStatus(result.data);
  if (status === "not_empty") return { ok: false, message: "Сначала переместите или удалите формулы из этой темы." };
  if (result.error || status !== "deleted") return { ok: false, message: "Не удалось удалить тему." };
  refresh(); return { ok: true, message: "Тема удалена." };
}

export async function moveFormulaRecallTopic(id: string, direction: -1 | 1): Promise<FormulaRecallActionResult> {
  const ctx = await context();
  if (!ctx || !uuid.test(id) || (direction !== -1 && direction !== 1)) return { ok: false, message: "Некорректные данные." };
  const result = await ctx.db.rpc("move_formula_recall_topic_atomic", { p_owner_admin_id: ctx.adminId, p_topic_id: id, p_direction: direction });
  if (result.error || rpcStatus(result.data) !== "moved") return { ok: false, message: "Не удалось изменить порядок тем." };
  refresh(); return { ok: true, message: "Порядок тем сохранён." };
}

export async function saveFormulaRecallFormula(draft: FormulaRecallDraft): Promise<FormulaRecallActionResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, message: "Некорректные данные формулы." };
  const validation = validateFormulaRecallDraft(draft);
  if (!validation.ok) return { ok: false, message: validation.message };
  const normalized = validation.draft;
  const result = await ctx.db.rpc("save_formula_recall_formula_atomic", {
    p_owner_admin_id: ctx.adminId, p_formula_id: normalized.formulaId, p_topic_id: normalized.topicId,
    p_expected_revision: normalized.expectedRevision, p_canonical_expression: normalized.canonicalExpression,
    p_conditions: normalized.conditions, p_alternatives: normalized.alternatives,
  });
  const data = result.data as { status?: string; formula_id?: string; content_revision?: number } | null;
  if (data?.status === "stale") return { ok: false, message: "Формула уже изменена в другой вкладке. Обновите страницу и повторите изменения." };
  if (data?.status === "topic_not_found") return { ok: false, message: "Выбранная тема больше недоступна." };
  if (data?.status === "duplicate_expression") return { ok: false, message: "Удалите повторяющиеся записи формулы." };
  if (result.error || data?.status !== "saved" || !data.formula_id) return { ok: false, message: "Не удалось сохранить формулу. Проверьте migration и введённые данные." };
  refresh(data.formula_id);
  return { ok: true, message: "Формула сохранена.", formulaId: data.formula_id, contentRevision: data.content_revision };
}

export async function saveFormulaRecallFormulasBatch(input: FormulaRecallBatchCreateInput): Promise<FormulaRecallBatchActionResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, message: "Недостаточно прав.", code: "forbidden" };
  if (!input || typeof input !== "object" || typeof input.requestId !== "string" || !uuid.test(input.requestId)
    || typeof input.topicId !== "string" || !uuid.test(input.topicId) || !Array.isArray(input.formulas)
    || input.formulas.length < 1 || input.formulas.length > 50 || JSON.stringify(input.formulas).length > 250000) {
    return { ok: false, message: "Проверьте набор формул.", code: "invalid_batch" };
  }
  const formulas = [];
  for (let index = 0; index < input.formulas.length; index += 1) {
    const validation = validateFormulaRecallDraft({ ...input.formulas[index], formulaId: null, topicId: input.topicId, expectedRevision: null });
    if (!validation.ok) return { ok: false, message: `Формула ${index + 1}: ${validation.message}`, formulaIndex: index, field: validation.field, code: validation.code };
    formulas.push({ canonical_expression: validation.draft.canonicalExpression, conditions: validation.draft.conditions, alternatives: validation.draft.alternatives });
  }
  const result = await ctx.db.rpc("save_formula_recall_formulas_batch_atomic", {
    p_owner_admin_id: ctx.adminId,
    p_topic_id: input.topicId,
    p_request_id: input.requestId,
    p_formulas: formulas,
  });
  const data = result.data as { status?: string; formula_ids?: unknown; formula_index?: unknown; field?: unknown; code?: unknown } | null;
  if (result.error) return { ok: false, message: "Не удалось сохранить набор формул. Проверьте, что новая migration применена.", code: "rpc_failed" };
  if ((data?.status === "saved" || data?.status === "already_saved") && Array.isArray(data.formula_ids) && data.formula_ids.every((id) => typeof id === "string" && uuid.test(id))) {
    refresh();
    return { ok: true, message: data.status === "already_saved" ? "Формулы уже были сохранены." : "Формулы сохранены.", formulaIds: data.formula_ids };
  }
  if (data?.status === "invalid_formula") {
    const formulaIndex = Number.isInteger(data.formula_index) ? Number(data.formula_index) : undefined;
    const field = typeof data.field === "string" ? data.field : "formula";
    const code = typeof data.code === "string" ? data.code : "invalid_formula";
    return { ok: false, message: `Проверьте ${batchFieldLabel(field)}.`, formulaIndex, field, code };
  }
  if (data?.status === "request_conflict") return { ok: false, message: "Этот запрос уже использован для другого набора. Повторите сохранение.", code: "request_conflict" };
  if (data?.status === "topic_not_found") return { ok: false, message: "Выбранная тема больше недоступна.", code: "topic_not_found" };
  if (data?.status === "forbidden") return { ok: false, message: "Недостаточно прав.", code: "forbidden" };
  if (data?.status === "invalid_batch") return { ok: false, message: "Набор должен содержать от 1 до 50 формул.", code: "invalid_batch" };
  return { ok: false, message: "Не удалось сохранить набор формул.", code: "save_failed" };
}

function batchFieldLabel(field: string) {
  return field === "alternatives" ? "альтернативные записи" : field === "conditions" || field === "conditions_or_alternatives" ? "условия и альтернативы" : "формулу";
}

export async function deleteFormulaRecallFormula(id: string): Promise<FormulaRecallActionResult> {
  const ctx = await context();
  if (!ctx || !uuid.test(id)) return { ok: false, message: "Формула недоступна." };
  const result = await ctx.db.rpc("delete_formula_recall_formula_atomic", { p_owner_admin_id: ctx.adminId, p_formula_id: id });
  if (result.error || rpcStatus(result.data) !== "deleted") return { ok: false, message: "Не удалось удалить формулу." };
  refresh(id); return { ok: true, message: "Формула удалена." };
}

export async function checkFormulaRecallPreviewAnswer(formulaId: string, studentExpression: string): Promise<FormulaRecallCheckActionResult> {
  const ctx = await context();
  if (!ctx || !uuid.test(formulaId)) return { ok: false, correct: false, reason: "forbidden", message: "Формула недоступна." };
  if (typeof studentExpression !== "string" || studentExpression.length > 4000) return { ok: false, correct: false, reason: "invalid_expression", message: "Ответ слишком длинный или некорректный." };
  const formulaResult = await ctx.db.from("formula_recall_formulas").select("canonical_expression").eq("id", formulaId).eq("owner_admin_id", ctx.adminId).maybeSingle();
  if (formulaResult.error || !formulaResult.data) return { ok: false, correct: false, reason: "not_found", message: "Формула недоступна." };
  const alternativesResult = await ctx.db.from("formula_recall_alternatives").select("expression").eq("formula_id", formulaId).order("sort_order");
  if (alternativesResult.error) return { ok: false, correct: false, reason: "load_failed", message: "Не удалось загрузить варианты формулы." };
  const { checkFormulaAnswer } = await import("@/lib/formula-recall/formula-checker");
  const result = checkFormulaAnswer({
    studentExpression,
    canonicalExpression: String(formulaResult.data.canonical_expression),
    alternativeExpressions: (alternativesResult.data ?? []).map((item) => String(item.expression)),
  });
  const checkable = result.correct || result.reason === "not_equivalent";
  return { ok: checkable, ...result, message: result.correct ? "Верно — формулы эквивалентны." : checkable ? "Пока неверно. Проверьте запись формулы." : "Не удалось разобрать ответ или сохранённую формулу. Проверьте полное равенство и обозначения." };
}
