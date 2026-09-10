import type { TrainerDefinition, TrainerSkill } from "./trainer-import";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TrainerGroup } from "./trainer-groups";
import { fingerprintTrainerSkill } from "./trainer-skill-fingerprint";

export { fingerprintTrainerSkill } from "./trainer-skill-fingerprint";

export type ActiveTrainerCard = { kind: "ACTIVE"; assignmentId: string; trainerId: string;groupId:string|null; title: string; type: "QUICK_PROBLEMS" | "THEORY"; assignedAt: string; skillsCount: number; creditedCorrect: number; progressPercent: number };
export type CompletedTrainerCard = { kind: "COMPLETED"; completionId: string; sourceTrainerId: string | null;groupId:string|null; title: string; type: string; assignedAt: string | null; completedAt: string; skillsCount: number; progressPercent: 100; canRestart: boolean };
export type TrainerCard = ActiveTrainerCard | CompletedTrainerCard;
export type AvailableTrainer = { id: string; title: string; type: "QUICK_PROBLEMS" | "THEORY";groupId:string|null };
export type TrainerTypeSummary = { type: string; progressPercent: number; activeCount: number; completedCount: number };

export function calculateTrainerProgress(cards: TrainerCard[]): { progressPercent: number } {
  let credited = 0;
  let possible = 0;
  for (const card of cards) {
    const requiredCredits = card.skillsCount * 5;
    possible += requiredCredits;
    credited += card.kind === "COMPLETED" ? requiredCredits : Math.min(requiredCredits, Math.max(0, card.creditedCorrect));
  }
  return { progressPercent: possible ? Math.round(credited / possible * 100) : 0 };
}

export function calculateTrainerTypeProgress(cards: TrainerCard[], type: string): { progressPercent: number } {
  return calculateTrainerProgress(cards.filter((card) => card.type === type));
}

type AssignmentRow = { id: string; trainer_id: string; student_id: string; owner_admin_id: string; assigned_at: string };
type TrainerRow = { id: string; owner_admin_id: string; type: "QUICK_PROBLEMS"; title: string; definition: TrainerDefinition;group_id:string|null };
type ProgressRow = { assignment_id: string; skill_key: string; skill_fingerprint: string; credited_correct: number };
type CompletionRow = { id: string; source_trainer_id: string | null; trainer_title: string; trainer_type: string; assigned_at: string | null; completed_at: string; skills_count: number; progress_percent: number };
type SummaryAssignmentRow = {
  id: string;
  trainer: { type: string; skills: TrainerSkill[] };
  progress: Pick<ProgressRow, "skill_key" | "skill_fingerprint" | "credited_correct">[];
};
type SummaryCompletionRow = Pick<CompletionRow, "trainer_type" | "skills_count">;

export async function loadStudentTrainerTypeSummaries(studentId: string) {
  const db = createAdminClient();
  const [assignmentsResult, completionsResult] = await Promise.all([
    db.from("trainer_assignments").select("id,trainer:trainers!inner(type,skills:definition->skills),progress:trainer_assignment_skill_progress(skill_key,skill_fingerprint,credited_correct)").eq("student_id", studentId),
    db.from("trainer_completion_history").select("trainer_type,skills_count").eq("student_id", studentId),
  ]);
  const error = assignmentsResult.error ?? completionsResult.error;
  if (error) return { summaries: [] as TrainerTypeSummary[], error };

  const totals = new Map<string, { credited: number; possible: number; activeCount: number; completedCount: number }>();
  const totalFor = (type: string) => {
    const existing = totals.get(type);
    if (existing) return existing;
    const created = { credited: 0, possible: 0, activeCount: 0, completedCount: 0 };
    totals.set(type, created);
    return created;
  };

  for (const assignment of (assignmentsResult.data ?? []) as unknown as SummaryAssignmentRow[]) {
    if (assignment.trainer?.type !== "QUICK_PROBLEMS") continue;
    const skills = Array.isArray(assignment.trainer?.skills) ? assignment.trainer.skills : [];
    const accepted = new Map(skills.map((skill) => [skill.key, fingerprintTrainerSkill(skill)]));
    let credited = 0;
    for (const row of assignment.progress ?? []) {
      if (accepted.get(row.skill_key) === row.skill_fingerprint) credited += Math.min(5, Math.max(0, row.credited_correct));
    }
    const total = totalFor(assignment.trainer.type);
    const requiredCredits = skills.length * 5;
    total.possible += requiredCredits;
    total.credited += Math.min(requiredCredits, Math.max(0, credited));
    total.activeCount += 1;
  }

  for (const completion of (completionsResult.data ?? []) as SummaryCompletionRow[]) {
    const total = totalFor(completion.trainer_type);
    const requiredCredits = completion.skills_count * 5;
    total.possible += requiredCredits;
    total.credited += requiredCredits;
    total.completedCount += 1;
  }

  return {
    summaries: [...totals].map(([type, total]) => ({
      type,
      progressPercent: total.possible ? Math.round(total.credited / total.possible * 100) : 0,
      activeCount: total.activeCount,
      completedCount: total.completedCount,
    })),
    error: null,
  };
}

export async function loadTrainerCards(studentId: string, ownerAdminId?: string) {
  const db = createAdminClient();
  let assignmentQuery = db.from("trainer_assignments").select("id,trainer_id,student_id,owner_admin_id,assigned_at,trainer:trainers!inner(type)").eq("student_id", studentId).eq("trainer.type", "QUICK_PROBLEMS").order("assigned_at", { ascending: false });
  let completionQuery = db.from("trainer_completion_history").select("id,source_trainer_id,trainer_title,trainer_type,assigned_at,completed_at,skills_count,progress_percent").eq("student_id", studentId).eq("trainer_type", "QUICK_PROBLEMS").order("completed_at", { ascending: false });
  if (ownerAdminId) { assignmentQuery = assignmentQuery.eq("owner_admin_id", ownerAdminId); completionQuery = completionQuery.eq("owner_admin_id", ownerAdminId); }
  const [assignmentsResult, completionsResult] = await Promise.all([assignmentQuery, completionQuery]);
  const firstError = assignmentsResult.error ?? completionsResult.error;
  if (firstError) return { cards: [] as TrainerCard[], trainerRows: [] as TrainerRow[], error: firstError };
  const assignments = (assignmentsResult.data ?? []) as AssignmentRow[];
  const completions = (completionsResult.data ?? []) as CompletionRow[];
  const trainerIds = [...new Set([...assignments.map((item) => item.trainer_id), ...completions.flatMap((item) => item.source_trainer_id ? [item.source_trainer_id] : [])])];
  const assignmentIds = assignments.map((item) => item.id);
  const [trainersResult, progressResult] = await Promise.all([
    trainerIds.length ? db.from("trainers").select("id,owner_admin_id,type,title,definition,group_id").in("id", trainerIds) : Promise.resolve({ data: [], error: null }),
    assignmentIds.length ? db.from("trainer_assignment_skill_progress").select("assignment_id,skill_key,skill_fingerprint,credited_correct").in("assignment_id", assignmentIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const relationError = trainersResult.error ?? progressResult.error;
  if (relationError) return { cards: [] as TrainerCard[], trainerRows: [] as TrainerRow[], error: relationError };
  const trainers = (trainersResult.data ?? []) as TrainerRow[];
  const trainerMap = new Map(trainers.map((trainer) => [trainer.id, trainer]));
  const progress = (progressResult.data ?? []) as ProgressRow[];
  const cards: TrainerCard[] = assignments.flatMap((assignment) => {
    const trainer = trainerMap.get(assignment.trainer_id); if (!trainer) return [];
    if (trainer.type !== "QUICK_PROBLEMS") return [];
    const skills = trainer.definition.skills;
    const accepted = new Map(skills.map((skill) => [skill.key, fingerprintTrainerSkill(skill)]));
    const creditedCorrect = progress.filter((row) => row.assignment_id === assignment.id && accepted.get(row.skill_key) === row.skill_fingerprint).reduce((sum, row) => sum + Math.min(5, Math.max(0, row.credited_correct)), 0);
    return [{ kind: "ACTIVE" as const, assignmentId: assignment.id, trainerId: trainer.id,groupId:trainer.group_id, title: trainer.title, type: trainer.type, assignedAt: assignment.assigned_at, skillsCount: skills.length, creditedCorrect, progressPercent: skills.length ? Math.round(creditedCorrect / (skills.length * 5) * 100) : 0 }];
  });
  cards.push(...completions.map((completion) => ({ kind: "COMPLETED" as const, completionId: completion.id, sourceTrainerId: completion.source_trainer_id,groupId:completion.source_trainer_id?trainerMap.get(completion.source_trainer_id)?.group_id??null:null, title: completion.trainer_title, type: completion.trainer_type, assignedAt: completion.assigned_at, completedAt: completion.completed_at, skillsCount: completion.skills_count, progressPercent: 100 as const, canRestart: Boolean(completion.source_trainer_id && trainerMap.get(completion.source_trainer_id)?.owner_admin_id === ownerAdminId) })));
  const groupIds=[...new Set(cards.flatMap(card=>card.groupId?[card.groupId]:[]))];const groupResult=groupIds.length?await db.from("trainer_groups").select("id,trainer_type,title,sort_order").eq("trainer_type","QUICK_PROBLEMS").in("id",groupIds).order("sort_order"):{data:[],error:null};
  const groups=((groupResult.data??[]) as {id:string;trainer_type:"QUICK_PROBLEMS";title:string;sort_order:number}[]).map((g):TrainerGroup=>({id:g.id,trainerType:g.trainer_type,title:g.title,sortOrder:g.sort_order}));
  return { cards, trainerRows: trainers,groups, error: groupResult.error };
}
