import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

type QueryError = { code?: string; message: string; details?: string; hint?: string };
export type TestSummary = { questionCount: number; maxPoints: number };

export async function loadTestSummaries(admin: ReturnType<typeof createAdminClient>, testIds: string[]) {
  const summaries = new Map<string, TestSummary>();
  for (const id of testIds) summaries.set(id, { questionCount: 0, maxPoints: 0 });
  if (!testIds.length) return { summaries, error: null as QueryError | null };
  const { data, error } = await admin.from("test_questions").select("test_id, points").in("test_id", testIds);
  if (error) {
    console.error("Не удалось загрузить агрегаты тестов:", { code: error.code, message: error.message, details: error.details, hint: error.hint });
    return { summaries, error };
  }
  for (const question of data ?? []) {
    const current = summaries.get(question.test_id) ?? { questionCount: 0, maxPoints: 0 };
    summaries.set(question.test_id, { questionCount: current.questionCount + 1, maxPoints: current.maxPoints + Number(question.points ?? 0) });
  }
  const generated = await admin.from("grade2_test_generators")
    .select("test_id,question_count").eq("is_active", true).in("test_id", testIds);
  if (generated.error) {
    console.error("Не удалось загрузить количество генерируемых заданий:", generated.error);
    return { summaries, error: generated.error };
  }
  for (const row of generated.data ?? []) {
    summaries.set(row.test_id, { questionCount: row.question_count, maxPoints: row.question_count });
  }
  return { summaries, error: null };
}
