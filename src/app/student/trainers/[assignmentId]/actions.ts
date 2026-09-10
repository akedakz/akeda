"use server";

import { revalidatePath } from "next/cache";
import { getTrainerStudentAccess, inactiveTrainerResult } from "@/lib/trainers/student-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentFingerprintMap, issueHintTaskBatch, issueNormalTaskBatch } from "@/lib/trainers/quick-problem-runner-server";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function refillNormalTasks(assignmentId: string) {
  const access = await getTrainerStudentAccess(); if (!access.ok) return access;
  const student = access.studentId; if (!student || !uuid.test(assignmentId)) return { ok: false as const, status: "forbidden" as const };
  const data = await issueNormalTaskBatch(student, assignmentId); if (data && "status" in data) return data; return data ? { ok: true as const, data } : { ok: false as const, status: "assignment_not_found" as const };
}

export async function refillHintTasks(assignmentId: string, sourceTaskId: string) {
  const access = await getTrainerStudentAccess(); if (!access.ok) return access;
  const student = access.studentId; if (!student || !uuid.test(assignmentId) || !uuid.test(sourceTaskId)) return { ok: false as const, status: "forbidden" as const };
  const tasks = await issueHintTaskBatch(student, assignmentId, sourceTaskId); if (tasks && "status" in tasks) return tasks; return tasks ? { ok: true as const, tasks } : { ok: false as const, status: "task_not_available" as const };
}

export async function recordQuickProblemAnswer(assignmentId: string, taskId: string, answer: number) {
  const access = await getTrainerStudentAccess(); if (!access.ok) return access;
  const student = access.studentId;
  if (!student || !uuid.test(assignmentId) || !uuid.test(taskId)) return { ok: false as const, status: "forbidden" as const };
  if (!Number.isSafeInteger(answer) || Math.abs(answer) > 1_000_000_000) return { ok: false as const, status: "invalid_answer" as const };
  const current = await currentFingerprintMap(student, assignmentId); if (!current) return { ok: false as const, status: "assignment_not_found" as const };
  const result = await createAdminClient().rpc("record_quick_problem_answer_atomic", { p_student_id: student, p_assignment_id: assignmentId, p_task_id: taskId, p_submitted_answer: answer, p_expected_content_revision: current.revision, p_skill_fingerprints: current.fingerprints });
  if (result.error) { console.error("Не удалось записать ответ тренажёра:", result.error); return { ok: false as const, status: "server_error" as const }; }
  const recorded = result.data as { status: string; correct?: boolean; mode?: "NORMAL" | "HINT"; credited_correct?: number; skill_completed?: boolean; trainer_completed?: boolean; progress_percent?: number };
  if (recorded.status === "student_inactive") return inactiveTrainerResult();
  if (recorded.status === "recorded" && recorded.correct && recorded.mode === "NORMAL") {
    revalidatePath("/student/trainers");
    revalidatePath("/student/trainers/quick-problems");
    revalidatePath("/student/progress");
    revalidatePath(`/admin/students/${student}`);
  }
  return { ok: true as const, result: recorded };
}

export async function recordTheoryAnswer(assignmentId: string, taskId: string, selectedOption: number) {
  const access = await getTrainerStudentAccess(); if (!access.ok) return access;
  const student = access.studentId; if (!student || !uuid.test(assignmentId) || !uuid.test(taskId) || !Number.isInteger(selectedOption) || selectedOption < 0 || selectedOption > 3) return { ok: false as const, status: "forbidden" as const };
  const response = await createAdminClient().rpc("record_theory_answer_and_issue_atomic", { p_student_id: student, p_assignment_id: assignmentId, p_task_id: taskId, p_selected_option: selectedOption });
  if (response.error) { console.error("Не удалось записать ответ Theory:", response.error); return { ok: false as const, status: "server_error" as const }; }
  if ((response.data as { status?: string } | null)?.status === "student_inactive") return inactiveTrainerResult();
  return { ok: true as const, result: response.data as { status: string; correct?: boolean; correct_option?: number; explanation?: string; question_count?: number; earned?: number; required?: number; progress_percent?: number; trainer_completed?: boolean; next_question?: { id: string; question_key: string; text: string; options: string[]; mastery: number } | null } };
}
