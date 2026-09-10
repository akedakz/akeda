import "server-only";

import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildAdminStudentTrainerReadModel, type AdminFormulaAssignmentRow, type AdminFormulaRow, type AdminFormulaTopicRow, type AdminQuickAssignmentRow, type AdminQuickCompletionRow, type AdminTheorySummaryRow, type AdminTrainerGroupRow, type AdminTrainerLibraryRow } from "./admin-student-read-model-core";

export const ADMIN_STUDENT_TRAINER_QUERY_WAVES = 1;

export const loadAdminStudentTrainerReadModel = cache(async function loadAdminStudentTrainerReadModel(studentId: string, ownerAdminId: string) {
  const db = createAdminClient();
  const [quickAssignments, quickCompletions, trainerLibrary, theorySummaries, groups, formulaTopics, formulas, formulaAssignments, activeMistakes, correctedMistakes] = await Promise.all([
    db.from("trainer_assignments").select("id,trainer_id,student_id,owner_admin_id,assigned_at,trainer:trainers!inner(id,owner_admin_id,type,title,group_id,skills:definition->skills),progress:trainer_assignment_skill_progress(skill_key,skill_fingerprint,credited_correct)").eq("student_id", studentId).eq("owner_admin_id", ownerAdminId).eq("trainer.owner_admin_id", ownerAdminId).eq("trainer.type", "QUICK_PROBLEMS").order("assigned_at", { ascending: false }),
    db.from("trainer_completion_history").select("id,source_trainer_id,trainer_title,trainer_type,assigned_at,completed_at,skills_count,progress_percent").eq("student_id", studentId).eq("owner_admin_id", ownerAdminId).eq("trainer_type", "QUICK_PROBLEMS").order("completed_at", { ascending: false }),
    db.from("trainers").select("id,owner_admin_id,type,title,group_id,status").eq("owner_admin_id", ownerAdminId).in("type", ["QUICK_PROBLEMS", "THEORY"]).order("title"),
    db.rpc("get_theory_student_summary", { p_student_id: studentId, p_owner_admin_id: ownerAdminId }),
    db.from("trainer_groups").select("id,trainer_type,title,sort_order").eq("owner_admin_id", ownerAdminId).order("sort_order"),
    db.from("formula_recall_topics").select("id,title,sort_order").eq("owner_admin_id", ownerAdminId).order("sort_order"),
    db.from("formula_recall_formulas").select("id,topic_id,canonical_expression,sort_order").eq("owner_admin_id", ownerAdminId).order("sort_order"),
    db.from("formula_recall_student_formulas").select("id,formula_id,clean_recall_count").eq("owner_admin_id", ownerAdminId).eq("student_id", studentId),
    db.from("student_mistakes").select("id", { count: "exact", head: true }).eq("student_id", studentId).eq("owner_admin_id", ownerAdminId).eq("status", "ACTIVE"),
    db.from("student_mistake_correction_attempts").select("id,mistake:student_mistakes!inner(student_id,owner_admin_id)", { count: "exact", head: true }).eq("mistake.student_id", studentId).eq("mistake.owner_admin_id", ownerAdminId).eq("is_correct", true),
  ]);

  const model = buildAdminStudentTrainerReadModel({
    ownerAdminId,
    quickAssignments: (quickAssignments.data ?? []) as unknown as AdminQuickAssignmentRow[],
    quickCompletions: (quickCompletions.data ?? []) as AdminQuickCompletionRow[],
    trainerLibrary: (trainerLibrary.data ?? []) as AdminTrainerLibraryRow[],
    theorySummaries: (theorySummaries.data ?? []) as AdminTheorySummaryRow[],
    groups: (groups.data ?? []) as AdminTrainerGroupRow[],
    formulaTopics: (formulaTopics.data ?? []) as AdminFormulaTopicRow[],
    formulas: (formulas.data ?? []) as AdminFormulaRow[],
    formulaAssignments: (formulaAssignments.data ?? []) as AdminFormulaAssignmentRow[],
    activeMistakes: activeMistakes.count ?? 0,
    correctedMistakes: correctedMistakes.count ?? 0,
  });

  return {
    trainers: { ...model.trainers, error: quickAssignments.error ?? quickCompletions.error ?? trainerLibrary.error ?? theorySummaries.error ?? groups.error },
    formulaRecall: { ...model.formulaRecall, error: formulaTopics.error ?? formulas.error ?? formulaAssignments.error },
    mistakes: { ...model.mistakes, error: Boolean(activeMistakes.error || correctedMistakes.error) },
  };
});

export function preloadAdminStudentTrainerReadModel(studentId: string, ownerAdminId: string) {
  void loadAdminStudentTrainerReadModel(studentId, ownerAdminId);
}
