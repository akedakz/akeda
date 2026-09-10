import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { SafeStudentQuestion, StudentAnswer } from "@/lib/tests/student-test-types";
import type { TestSnapshotQuestion } from "@/lib/tests/test-snapshot-types";

type SafeQuestionWire = Omit<SafeStudentQuestion, "imageUrl"> & { imagePath: string | null };
type StudentRpc = { status: "ready" | "empty" | "forbidden"; activeCount?: number; mistake?: { id: string; activationVersion: number; question: SafeQuestionWire; sourceTitle: string; lastFailedAt: string } };
export type StudentMistakeSession = { activeCount: number; mistake: null | { id: string; activationVersion: number; question: SafeStudentQuestion; sourceTitle: string; lastFailedAt: string } };
export type AdminMistake = { id: string; activationVersion: number; question: TestSnapshotQuestion; latestFailedAnswer: StudentAnswer | null; sourceTitle: string; firstFailedAt: string; lastFailedAt: string; reactivationCount: number; imageUrl: string | null };

async function sign(paths: string[]) {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return new Map<string, string>();
  const result = await createAdminClient().storage.from("test-images").createSignedUrls(unique, 3600);
  if (result.error) { console.error("MISTAKE_IMAGE_SIGN", { name: result.error.name, message: result.error.message }); return new Map<string, string>(); }
  return new Map(result.data.flatMap((item) => item.signedUrl ? [[item.path, item.signedUrl] as const] : []));
}

export async function loadStudentMistakeSession(studentId: string): Promise<StudentMistakeSession> {
  const result = await createAdminClient().rpc("load_student_mistake_trainer", { p_student_id: studentId });
  if (result.error) { console.error("MISTAKE_STUDENT_LOAD", { code: result.error.code, message: result.error.message }); throw new Error("MISTAKE_LOAD_FAILED"); }
  const data = result.data as StudentRpc;
  if (data.status !== "ready" || !data.mistake) return { activeCount: data.activeCount ?? 0, mistake: null };
  const path = data.mistake.question.imagePath;
  const urls = await sign(path ? [path] : []);
  const { imagePath: _imagePath, ...question } = data.mistake.question;
  void _imagePath;
  return { activeCount: data.activeCount ?? 0, mistake: { ...data.mistake, question: { ...question, imageUrl: path ? urls.get(path) ?? null : null } as SafeStudentQuestion } };
}

export async function countActiveStudentMistakes(studentId: string, ownerAdminId?: string) {
  let query = createAdminClient().from("student_mistakes").select("id", { count: "exact", head: true }).eq("student_id", studentId).eq("status", "ACTIVE");
  if (ownerAdminId) query = query.eq("owner_admin_id", ownerAdminId);
  const result = await query;
  if (result.error) { console.error("MISTAKE_COUNT", { code: result.error.code, message: result.error.message }); return 0; }
  return result.count ?? 0;
}

export async function loadStudentMistakeStats(studentId: string) {
  const db = createAdminClient();
  const [active, corrected] = await Promise.all([
    db.from("student_mistakes").select("id", { count: "exact", head: true }).eq("student_id", studentId).eq("status", "ACTIVE"),
    db.from("student_mistake_correction_attempts").select("id,mistake:student_mistakes!inner(student_id)", { count: "exact", head: true }).eq("mistake.student_id", studentId).eq("is_correct", true),
  ]);
  const error = active.error ?? corrected.error;
  return { active: active.count ?? 0, corrected: corrected.count ?? 0, error };
}

export async function loadAdminStudentMistakes(studentId: string, adminId: string): Promise<AdminMistake[]> {
  const result = await createAdminClient().from("student_mistakes").select("id,activation_version,current_question_snapshot,latest_failed_answer,latest_assignment_title_snapshot,first_failed_at,last_failed_at,reactivation_count").eq("student_id", studentId).eq("owner_admin_id", adminId).eq("status", "ACTIVE").order("activation_sequence").order("id");
  if (result.error) { console.error("MISTAKE_ADMIN_LOAD", { code: result.error.code, message: result.error.message }); throw new Error("MISTAKE_ADMIN_LOAD_FAILED"); }
  const paths = result.data.flatMap((row) => { const path = (row.current_question_snapshot as { imagePath?: unknown }).imagePath; return typeof path === "string" && path ? [path] : []; });
  const urls = await sign(paths);
  return result.data.map((row) => { const question = row.current_question_snapshot as TestSnapshotQuestion; return { id: row.id, activationVersion: row.activation_version, question, latestFailedAnswer: row.latest_failed_answer as StudentAnswer | null, sourceTitle: row.latest_assignment_title_snapshot, firstFailedAt: row.first_failed_at, lastFailedAt: row.last_failed_at, reactivationCount: row.reactivation_count, imageUrl: question.imagePath ? urls.get(question.imagePath) ?? null : null }; });
}
