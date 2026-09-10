import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TrainerGroup } from "./trainer-groups";

export type TheorySummaryCard = { kind: "ACTIVE" | "COMPLETED"; assignmentId: string | null; completionId: string | null; sourceTrainerId: string | null; groupId:string|null; title: string; assignedAt: string; completedAt: string | null; questionCount: number; earned: number; required: number; progressPercent: number; canRestart: boolean };
export type TheoryRunnerSession = { assignmentId: string; title: string; earned: number; required: number; progressPercent: number; task: { id: string; questionKey: string; text: string; options: string[]; mastery: number } };
type SummaryRow = { kind: "ACTIVE" | "COMPLETED"; assignment_id: string | null; completion_id?: string | null; source_trainer_id: string | null; group_id?:string|null; title: string; sort_at: string; completed_at: string | null; question_count: number; earned: number; can_restart?: boolean };
type IssuedTheorySession = { status: string; assignment_id?: string; title?: string; earned?: number; required?: number; progress_percent?: number; task?: { id: string; question_key: string; text: string; options: string[]; mastery: number } };

export async function loadTheorySummaries(studentId: string, ownerAdminId?: string) {
  const result = await createAdminClient().rpc("get_theory_student_summary", { p_student_id: studentId, p_owner_admin_id: ownerAdminId ?? null });
  if (result.error) return { cards: [] as TheorySummaryCard[], error: result.error };
  const cards = ((result.data ?? []) as SummaryRow[]).map((row) => { const required = row.question_count * 3; const earned = row.kind === "COMPLETED" ? required : Math.min(required, Math.max(0, row.earned)); return { kind: row.kind, assignmentId: row.assignment_id, completionId: row.completion_id ?? null, sourceTrainerId: row.source_trainer_id,groupId:row.group_id??null, title: row.title, assignedAt: row.sort_at, completedAt: row.completed_at, questionCount: row.question_count, earned, required, progressPercent: required ? Math.round(earned / required * 100) : 0, canRestart: row.kind === "COMPLETED" && row.can_restart === true }; });
  const ids=[...new Set(cards.flatMap(card=>card.groupId?[card.groupId]:[]))];const groupsResult=ids.length?await createAdminClient().from("trainer_groups").select("id,trainer_type,title,sort_order").eq("trainer_type","THEORY").in("id",ids).order("sort_order"): {data:[],error:null};
  const groups=((groupsResult.data??[]) as {id:string;trainer_type:"THEORY";title:string;sort_order:number}[]).map((g):TrainerGroup=>({id:g.id,trainerType:g.trainer_type,title:g.title,sortOrder:g.sort_order}));
  return { cards,groups, error: groupsResult.error };
}
export function calculateTheoryOverall(cards: TheorySummaryCard[]) { const required = cards.reduce((sum, card) => sum + card.required, 0); const earned = cards.reduce((sum, card) => sum + card.earned, 0); return required ? Math.round(earned / required * 100) : 0; }

export async function issueTheoryQuestion(studentId: string, assignmentId: string): Promise<TheoryRunnerSession | null> {
  const response = await createAdminClient().rpc("issue_theory_question_atomic", { p_student_id: studentId, p_assignment_id: assignmentId });
  if (response.error) return null;
  const issued = response.data as IssuedTheorySession;
  if (issued.status !== "issued" || !issued.assignment_id || !issued.title || !issued.task || issued.earned === undefined || issued.required === undefined || issued.progress_percent === undefined) return null;
  return { assignmentId: issued.assignment_id, title: issued.title, earned: issued.earned, required: issued.required, progressPercent: issued.progress_percent, task: { id: issued.task.id, questionKey: issued.task.question_key, text: issued.task.text, options: issued.task.options, mastery: issued.task.mastery } };
}
