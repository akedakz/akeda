import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FormulaRecallAlternative, FormulaRecallCondition, FormulaRecallFormula, FormulaRecallTopic } from "./types";

type TopicRow = { id: string; title: string; sort_order: number };
type FormulaRow = { id: string; topic_id: string; canonical_expression: string; sort_order: number; content_revision: number; updated_at: string };
type ConditionRow = { id: string; formula_id: string; text: string; sort_order: number };
type AlternativeRow = { id: string; formula_id: string; expression: string; sort_order: number };

export async function loadFormulaRecallTopics(ownerAdminId: string) {
  const result = await createAdminClient().from("formula_recall_topics").select("id,title,sort_order").eq("owner_admin_id", ownerAdminId).order("sort_order");
  const topics = ((result.data ?? []) as TopicRow[]).map((row): FormulaRecallTopic => ({ id: row.id, title: row.title, sortOrder: row.sort_order }));
  return { topics, error: result.error };
}

export async function loadFormulaRecallLibrary(ownerAdminId: string) {
  const db = createAdminClient();
  const [topicResult, formulaResult] = await Promise.all([
    db.from("formula_recall_topics").select("id,title,sort_order").eq("owner_admin_id", ownerAdminId).order("sort_order"),
    db.from("formula_recall_formulas").select("id,topic_id,canonical_expression,sort_order,content_revision,updated_at").eq("owner_admin_id", ownerAdminId).order("sort_order"),
  ]);
  const topics = ((topicResult.data ?? []) as TopicRow[]).map((row): FormulaRecallTopic => ({ id: row.id, title: row.title, sortOrder: row.sort_order }));
  const formulaRows = (formulaResult.data ?? []) as FormulaRow[];
  const ids = formulaRows.map((row) => row.id);
  const empty = Promise.resolve({ data: [], error: null });
  const [conditionResult, alternativeResult] = await Promise.all([
    ids.length ? db.from("formula_recall_conditions").select("id,formula_id,text,sort_order").in("formula_id", ids).order("sort_order") : empty,
    ids.length ? db.from("formula_recall_alternatives").select("id,formula_id,expression,sort_order").in("formula_id", ids).order("sort_order") : empty,
  ]);
  const conditions = (conditionResult.data ?? []) as ConditionRow[];
  const alternatives = (alternativeResult.data ?? []) as AlternativeRow[];
  const formulas = formulaRows.map((row): FormulaRecallFormula => ({
    id: row.id, topicId: row.topic_id, canonicalExpression: row.canonical_expression, sortOrder: row.sort_order,
    contentRevision: row.content_revision, updatedAt: row.updated_at,
    conditions: conditions.filter((item) => item.formula_id === row.id).map((item): FormulaRecallCondition => ({ id: item.id, text: item.text, sortOrder: item.sort_order })),
    alternatives: alternatives.filter((item) => item.formula_id === row.id).map((item): FormulaRecallAlternative => ({ id: item.id, expression: item.expression, sortOrder: item.sort_order })),
  }));
  return { topics, formulas, error: topicResult.error ?? formulaResult.error ?? conditionResult.error ?? alternativeResult.error };
}

export async function loadFormulaRecallFormula(ownerAdminId: string, formulaId: string) {
  const library = await loadFormulaRecallLibrary(ownerAdminId);
  return { ...library, formula: library.formulas.find((item) => item.id === formulaId) ?? null };
}
