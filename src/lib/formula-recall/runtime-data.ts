import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { FORMULA_RECALL_MASTERY_TARGET, type FormulaRecallAssignmentTopic, type FormulaRecallStudentSummary, type FormulaRecallStudentTask } from "./runtime-types";

type AssignmentRow = { id: string; formula_id: string; clean_recall_count: number };
type FormulaRow = { id: string; topic_id: string; canonical_expression: string };
type TopicRow = { id: string; title: string; sort_order: number };

export async function loadFormulaRecallSummary(studentId: string, ownerAdminId?: string): Promise<{ summary: FormulaRecallStudentSummary; error: unknown }> {
  const db = createAdminClient();
  let assignmentsQuery = db.from("formula_recall_student_formulas").select("formula_id,clean_recall_count").eq("student_id", studentId);
  if (ownerAdminId) assignmentsQuery = assignmentsQuery.eq("owner_admin_id", ownerAdminId);
  const assignmentsResult = await assignmentsQuery;
  if (assignmentsResult.error) return { summary: emptySummary(), error: assignmentsResult.error };
  const assignments = (assignmentsResult.data ?? []) as Array<Pick<AssignmentRow, "formula_id" | "clean_recall_count">>;
  if (!assignments.length) return { summary: emptySummary(), error: null };
  const formulasResult = await db.from("formula_recall_formulas").select("id,topic_id,canonical_expression").in("id", assignments.map((item) => item.formula_id));
  const formulas = (formulasResult.data ?? []) as FormulaRow[];
  const topicIds = [...new Set(formulas.map((item) => item.topic_id))];
  const topicsResult = topicIds.length ? await db.from("formula_recall_topics").select("id,title,sort_order").in("id", topicIds).order("sort_order") : { data: [], error: null };
  const error = formulasResult.error ?? topicsResult.error;
  if (error) return { summary: emptySummary(), error };
  const assignmentMap = new Map(assignments.map((item) => [item.formula_id, Math.min(FORMULA_RECALL_MASTERY_TARGET, Math.max(0, item.clean_recall_count))]));
  const topicSummaries = ((topicsResult.data ?? []) as TopicRow[]).map((topic) => {
    const topicFormulas = formulas.filter((formula) => formula.topic_id === topic.id);
    const masteryPoints = topicFormulas.reduce((sum, formula) => sum + (assignmentMap.get(formula.id) ?? 0), 0);
    const possiblePoints = topicFormulas.length * FORMULA_RECALL_MASTERY_TARGET;
    return { id: topic.id, title: topic.title, assignedCount: topicFormulas.length, masteryPoints, possiblePoints, progressPercent: percent(masteryPoints, possiblePoints) };
  }).filter((topic) => topic.assignedCount > 0);
  const masteryPoints = [...assignmentMap.values()].reduce((sum, value) => sum + value, 0);
  const possiblePoints = assignments.length * FORMULA_RECALL_MASTERY_TARGET;
  const masteredIds = new Set(assignments.filter((item) => item.clean_recall_count === FORMULA_RECALL_MASTERY_TARGET).map((item) => item.formula_id));
  const masteredTopics = ((topicsResult.data ?? []) as TopicRow[]).map((topic) => ({ id: topic.id, title: topic.title, formulas: formulas.filter((formula) => formula.topic_id === topic.id && masteredIds.has(formula.id)).map((formula) => ({ id: formula.id, expression: formula.canonical_expression })) })).filter((topic) => topic.formulas.length > 0);
  return { summary: { assignedCount: assignments.length, masteryPoints, possiblePoints, progressPercent: percent(masteryPoints, possiblePoints), allMastered: masteryPoints === possiblePoints, topics: topicSummaries, masteredTopics }, error: null };
}

export async function loadAdminFormulaRecallAssignments(studentId: string, ownerAdminId: string) {
  const db = createAdminClient();
  const [topicsResult, formulasResult, assignmentsResult] = await Promise.all([
    db.from("formula_recall_topics").select("id,title,sort_order").eq("owner_admin_id", ownerAdminId).order("sort_order"),
    db.from("formula_recall_formulas").select("id,topic_id,canonical_expression").eq("owner_admin_id", ownerAdminId).order("sort_order"),
    db.from("formula_recall_student_formulas").select("id,formula_id,clean_recall_count").eq("owner_admin_id", ownerAdminId).eq("student_id", studentId),
  ]);
  const error = topicsResult.error ?? formulasResult.error ?? assignmentsResult.error;
  const assignments = (assignmentsResult.data ?? []) as AssignmentRow[];
  const assignmentMap = new Map(assignments.map((item) => [item.formula_id, item]));
  const formulas = (formulasResult.data ?? []) as FormulaRow[];
  const topics: FormulaRecallAssignmentTopic[] = ((topicsResult.data ?? []) as TopicRow[]).map((topic) => ({
    id: topic.id,
    title: topic.title,
    formulas: formulas.filter((formula) => formula.topic_id === topic.id).map((formula) => {
      const assigned = assignmentMap.get(formula.id);
      return { assignmentId: assigned?.id ?? null, formulaId: formula.id, topicId: topic.id, expression: formula.canonical_expression, cleanRecallCount: assigned?.clean_recall_count ?? 0 };
    }),
  }));
  const summary = await loadFormulaRecallSummary(studentId, ownerAdminId);
  return { topics, summary: summary.summary, error: error ?? summary.error };
}

export async function loadFormulaRecallTask(studentId: string, taskId: string): Promise<FormulaRecallStudentTask | null> {
  const db = createAdminClient();
  const result = await db.from("formula_recall_tasks").select("id,condition_text_snapshot,topic_title_snapshot,state,canonical_expression_snapshot,credit_awarded").eq("id", taskId).eq("student_id", studentId).neq("state", "DONE").maybeSingle();
  if (result.error || !result.data) return null;
  const row = result.data;
  const state = row.state as FormulaRecallStudentTask["state"];
  return { id: row.id, condition: row.condition_text_snapshot, topicTitle: row.topic_title_snapshot, state, canonicalExpression: state === "REVEALED" ? row.canonical_expression_snapshot : undefined, creditAwarded: row.credit_awarded };
}

export async function loadActiveFormulaRecallTask(studentId: string): Promise<FormulaRecallStudentTask | null> {
  const db = createAdminClient();
  const result = await db.from("formula_recall_tasks").select("id").eq("student_id", studentId).neq("state", "DONE").maybeSingle();
  return result.data?.id ? loadFormulaRecallTask(studentId, result.data.id) : null;
}

function percent(points: number, possible: number) { return possible ? Math.round(points / possible * 100) : 100; }
function emptySummary(): FormulaRecallStudentSummary { return { assignedCount: 0, masteryPoints: 0, possiblePoints: 0, progressPercent: 100, allMastered: true, topics: [], masteredTopics: [] }; }
