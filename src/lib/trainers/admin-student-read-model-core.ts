import type { FormulaRecallAssignmentTopic, FormulaRecallStudentSummary } from "../formula-recall/runtime-types";
import { FORMULA_RECALL_MASTERY_TARGET } from "../formula-recall/runtime-types";
import type { TrainerSkill } from "./trainer-import";
import type { AvailableTrainer, TrainerCard } from "./trainer-progress";
import type { TrainerGroup } from "./trainer-groups";
import { fingerprintTrainerSkill } from "./trainer-skill-fingerprint";

export type AdminQuickTrainerRow = {
  id: string;
  owner_admin_id: string;
  type: "QUICK_PROBLEMS";
  title: string;
  group_id: string | null;
  skills: TrainerSkill[];
};

export type AdminQuickAssignmentRow = {
  id: string;
  trainer_id: string;
  student_id: string;
  owner_admin_id: string;
  assigned_at: string;
  trainer: AdminQuickTrainerRow;
  progress: Array<{ skill_key: string; skill_fingerprint: string; credited_correct: number }>;
};

export type AdminQuickCompletionRow = {
  id: string;
  source_trainer_id: string | null;
  trainer_title: string;
  trainer_type: string;
  assigned_at: string | null;
  completed_at: string;
  skills_count: number;
  progress_percent: number;
};

export type AdminTrainerLibraryRow = {
  id: string;
  owner_admin_id: string;
  type: "QUICK_PROBLEMS" | "THEORY";
  title: string;
  group_id: string | null;
  status: string;
};

export type AdminTheorySummaryRow = {
  kind: "ACTIVE" | "COMPLETED";
  assignment_id: string | null;
  completion_id?: string | null;
  source_trainer_id: string | null;
  group_id?: string | null;
  title: string;
  sort_at: string;
  completed_at: string | null;
  question_count: number;
  earned: number;
  can_restart?: boolean;
};

export type AdminTrainerGroupRow = { id: string; trainer_type: "QUICK_PROBLEMS" | "THEORY"; title: string; sort_order: number };
export type AdminFormulaTopicRow = { id: string; title: string; sort_order: number };
export type AdminFormulaRow = { id: string; topic_id: string; canonical_expression: string; sort_order: number };
export type AdminFormulaAssignmentRow = { id: string; formula_id: string; clean_recall_count: number };

export type AdminStudentTrainerRows = {
  ownerAdminId: string;
  quickAssignments: AdminQuickAssignmentRow[];
  quickCompletions: AdminQuickCompletionRow[];
  trainerLibrary: AdminTrainerLibraryRow[];
  theorySummaries: AdminTheorySummaryRow[];
  groups: AdminTrainerGroupRow[];
  formulaTopics: AdminFormulaTopicRow[];
  formulas: AdminFormulaRow[];
  formulaAssignments: AdminFormulaAssignmentRow[];
  activeMistakes: number;
  correctedMistakes: number;
};

export function buildAdminStudentTrainerReadModel(rows: AdminStudentTrainerRows) {
  const libraryById = new Map(rows.trainerLibrary.map((trainer) => [trainer.id, trainer]));
  const quickCards: TrainerCard[] = rows.quickAssignments.flatMap((assignment) => {
    const trainer = assignment.trainer;
    if (!trainer || trainer.type !== "QUICK_PROBLEMS" || trainer.owner_admin_id !== rows.ownerAdminId) return [];
    const skills = Array.isArray(trainer.skills) ? trainer.skills : [];
    const accepted = new Map(skills.map((skill) => [skill.key, fingerprintTrainerSkill(skill)]));
    const creditedCorrect = (assignment.progress ?? []).reduce((total, progress) => accepted.get(progress.skill_key) === progress.skill_fingerprint ? total + Math.min(5, Math.max(0, progress.credited_correct)) : total, 0);
    return [{ kind: "ACTIVE" as const, assignmentId: assignment.id, trainerId: trainer.id, groupId: trainer.group_id, title: trainer.title, type: trainer.type, assignedAt: assignment.assigned_at, skillsCount: skills.length, creditedCorrect, progressPercent: skills.length ? Math.round(creditedCorrect / (skills.length * 5) * 100) : 0 }];
  });
  quickCards.push(...rows.quickCompletions.map((completion) => {
    const source = completion.source_trainer_id ? libraryById.get(completion.source_trainer_id) : null;
    return { kind: "COMPLETED" as const, completionId: completion.id, sourceTrainerId: completion.source_trainer_id, groupId: source?.group_id ?? null, title: completion.trainer_title, type: completion.trainer_type, assignedAt: completion.assigned_at, completedAt: completion.completed_at, skillsCount: completion.skills_count, progressPercent: 100 as const, canRestart: Boolean(source?.owner_admin_id === rows.ownerAdminId) };
  }));

  const theoryCards: TrainerCard[] = rows.theorySummaries.map((row) => {
    const required = row.question_count * 3;
    const earned = row.kind === "COMPLETED" ? required : Math.min(required, Math.max(0, row.earned));
    const progressPercent = required ? Math.round(earned / required * 100) : 0;
    return row.kind === "ACTIVE"
      ? { kind: "ACTIVE", assignmentId: row.assignment_id!, trainerId: row.source_trainer_id!, groupId: row.group_id ?? null, title: row.title, type: "THEORY", assignedAt: row.sort_at, skillsCount: row.question_count, creditedCorrect: earned, progressPercent }
      : { kind: "COMPLETED", completionId: row.completion_id!, sourceTrainerId: row.source_trainer_id, groupId: row.group_id ?? null, title: row.title, type: "THEORY", assignedAt: row.sort_at, completedAt: row.completed_at!, skillsCount: row.question_count, progressPercent: 100, canRestart: row.can_restart === true };
  });
  const cards = [...quickCards, ...theoryCards];
  const blocked = new Set(cards.flatMap((card) => card.kind === "ACTIVE" ? [card.trainerId] : card.sourceTrainerId ? [card.sourceTrainerId] : []));
  const available: AvailableTrainer[] = rows.trainerLibrary
    .filter((trainer) => !blocked.has(trainer.id) && (trainer.type === "QUICK_PROBLEMS" || trainer.status === "PUBLISHED"))
    .map((trainer) => ({ id: trainer.id, title: trainer.title, type: trainer.type, groupId: trainer.group_id }));
  const groups: TrainerGroup[] = rows.groups.map((group) => ({ id: group.id, trainerType: group.trainer_type, title: group.title, sortOrder: group.sort_order }));

  const assignmentByFormula = new Map(rows.formulaAssignments.map((assignment) => [assignment.formula_id, assignment]));
  const topics: FormulaRecallAssignmentTopic[] = rows.formulaTopics.map((topic) => ({
    id: topic.id,
    title: topic.title,
    formulas: rows.formulas.filter((formula) => formula.topic_id === topic.id).map((formula) => {
      const assigned = assignmentByFormula.get(formula.id);
      return { assignmentId: assigned?.id ?? null, formulaId: formula.id, topicId: topic.id, expression: formula.canonical_expression, cleanRecallCount: assigned?.clean_recall_count ?? 0 };
    }),
  }));
  const summary = buildFormulaSummary(rows.formulaTopics, rows.formulas, rows.formulaAssignments);

  return {
    trainers: { cards, available, groups },
    formulaRecall: { topics, summary },
    mistakes: { active: rows.activeMistakes, corrected: rows.correctedMistakes },
  };
}

function buildFormulaSummary(topics: AdminFormulaTopicRow[], formulas: AdminFormulaRow[], assignments: AdminFormulaAssignmentRow[]): FormulaRecallStudentSummary {
  const masteryByFormula = new Map(assignments.map((assignment) => [assignment.formula_id, Math.min(FORMULA_RECALL_MASTERY_TARGET, Math.max(0, assignment.clean_recall_count))]));
  const topicSummaries = topics.map((topic) => {
    const assigned = formulas.filter((formula) => formula.topic_id === topic.id && masteryByFormula.has(formula.id));
    const masteryPoints = assigned.reduce((total, formula) => total + masteryByFormula.get(formula.id)!, 0);
    const possiblePoints = assigned.length * FORMULA_RECALL_MASTERY_TARGET;
    return { id: topic.id, title: topic.title, assignedCount: assigned.length, masteryPoints, possiblePoints, progressPercent: percent(masteryPoints, possiblePoints) };
  }).filter((topic) => topic.assignedCount > 0);
  const masteryPoints = [...masteryByFormula.values()].reduce((total, value) => total + value, 0);
  const possiblePoints = assignments.length * FORMULA_RECALL_MASTERY_TARGET;
  const mastered = new Set(assignments.filter((assignment) => assignment.clean_recall_count === FORMULA_RECALL_MASTERY_TARGET).map((assignment) => assignment.formula_id));
  const masteredTopics = topics.map((topic) => ({ id: topic.id, title: topic.title, formulas: formulas.filter((formula) => formula.topic_id === topic.id && mastered.has(formula.id)).map((formula) => ({ id: formula.id, expression: formula.canonical_expression })) })).filter((topic) => topic.formulas.length > 0);
  return { assignedCount: assignments.length, masteryPoints, possiblePoints, progressPercent: percent(masteryPoints, possiblePoints), allMastered: masteryPoints === possiblePoints, topics: topicSummaries, masteredTopics };
}

function percent(points: number, possible: number) { return possible ? Math.round(points / possible * 100) : 100; }
