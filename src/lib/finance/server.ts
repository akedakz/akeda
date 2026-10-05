import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { FinanceEntryType, StudentFinanceSummary } from "./types";

type SettingsRow = { rate_per_60_kzt: number; billing_started_at: string };
type EntryRow = { id: string; entry_type: FinanceEntryType; amount_kzt: number; lesson_id: string | null; duration_minutes_snapshot: number | null; rate_per_60_kzt_snapshot: number | null; note: string | null; created_at: string };

export async function loadStudentFinance(studentId: string): Promise<StudentFinanceSummary> {
  const admin = createAdminClient();
  const reconciled = await admin.rpc("reconcile_student_finance_atomic", { p_student_id: studentId });
  if (reconciled.error && reconciled.error.code !== "PGRST202") throw reconciled.error;

  const [settingsResult, entriesResult] = await Promise.all([
    admin.from("student_finance_settings").select("rate_per_60_kzt,billing_started_at").eq("student_id", studentId).maybeSingle(),
    admin.from("student_financial_entries").select("id,entry_type,amount_kzt,lesson_id,duration_minutes_snapshot,rate_per_60_kzt_snapshot,note,created_at").eq("student_id", studentId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(50),
  ]);
  if (settingsResult.error || entriesResult.error) throw settingsResult.error ?? entriesResult.error;
  const settings = settingsResult.data as SettingsRow | null;
  const rows = (entriesResult.data ?? []) as EntryRow[];
  const lessonIds = [...new Set(rows.flatMap((row) => row.lesson_id ? [row.lesson_id] : []))];
  const [balanceKzt, lessonsResult] = await Promise.all([
    rows.length ? loadBalance(studentId) : Promise.resolve(0),
    lessonIds.length
      ? admin.from("student_lessons").select("id,starts_at").in("id", lessonIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (lessonsResult.error) throw lessonsResult.error;
  const lessonStartedAt = new Map((lessonsResult.data ?? []).map((lesson) => [lesson.id, lesson.starts_at]));
  const entries = rows.map((row) => ({
    id: row.id,
    type: row.entry_type,
    amountKzt: Number(row.amount_kzt),
    lessonId: row.lesson_id,
    durationMinutes: row.duration_minutes_snapshot,
    ratePer60Kzt: row.rate_per_60_kzt_snapshot,
    note: row.note,
    lessonStartedAt: row.lesson_id ? lessonStartedAt.get(row.lesson_id) ?? null : null,
    createdAt: row.created_at,
  })).sort((a, b) => Date.parse(b.lessonStartedAt ?? b.createdAt) - Date.parse(a.lessonStartedAt ?? a.createdAt)).slice(0, 20);
  const rate = settings ? Number(settings.rate_per_60_kzt) : null;
  return {
    ratePer60Kzt: rate,
    billingStartedAt: settings?.billing_started_at ?? null,
    balanceKzt,
    remainingLessonEquivalents: rate ? Math.max(balanceKzt, 0) / rate : null,
    entries,
  };
}

async function loadBalance(studentId: string) {
  const admin = createAdminClient();
  const result = await admin.from("student_financial_entries").select("amount_kzt").eq("student_id", studentId);
  if (result.error) throw result.error;
  return (result.data ?? []).reduce((sum, row) => sum + Number(row.amount_kzt), 0);
}
