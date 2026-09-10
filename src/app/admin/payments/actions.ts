"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMonday } from "@/lib/payments/week";
import type { WeeklyPaymentRow } from "@/lib/payments/types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Result = { ok: boolean; message: string };
type CreateResult = Result & { row?: WeeklyPaymentRow };

async function context() {
  const current = await getCurrentProfile();
  return current?.profile?.role === "ADMIN" ? { id: current.profile.id, admin: createAdminClient() } : null;
}

function refresh() { revalidatePath("/admin/payments"); }

export async function addWeeklyPaymentRow(weekStart: string, input: { studentName: string; subject: string; price: number; lessons: number; notes: string }): Promise<CreateResult> {
  const ctx = await context();
  const studentName = input.studentName.trim(), subject = input.subject.trim(), notes = input.notes.trim();
  if (!ctx || !isMonday(weekStart) || !studentName || studentName.length > 120 || !subject || subject.length > 120 || !Number.isInteger(input.price) || input.price < 0 || input.price > 10000000 || !Number.isInteger(input.lessons) || input.lessons < 0 || input.lessons > 1000 || notes.length > 500) return { ok: false, message: "Проверьте данные новой строки." };
  const last = await ctx.admin.from("weekly_payment_rows").select("sort_order").eq("owner_admin_id", ctx.id).eq("week_start", weekStart).order("sort_order", { ascending: false }).limit(1);
  if (last.error) return { ok: false, message: "Не удалось определить порядок строк." };
  const { data, error } = await ctx.admin.from("weekly_payment_rows").insert({
    owner_admin_id: ctx.id, week_start: weekStart, student_name: studentName, subject,
    price_per_lesson_kzt: input.price, lessons_count: input.lessons, notes: notes || null, sort_order: (last.data?.[0]?.sort_order ?? -1) + 1,
  }).select("id,student_name,subject,price_per_lesson_kzt,lessons_count,amount_due_kzt,paid,paid_at,notes,sort_order").single();
  if (error || !data) return { ok: false, message: "Не удалось добавить строку." };
  refresh();
  return { ok: true, message: "Сохранено.", row: data as WeeklyPaymentRow };
}

export async function saveWeeklyPaymentRow(rowId: string, input: { studentName: string; subject: string; price: number; lessons: number; notes: string }): Promise<Result> {
  const ctx = await context();
  const studentName = input.studentName.trim(), subject = input.subject.trim(), notes = input.notes.trim();
  if (!ctx || !uuid.test(rowId) || !studentName || studentName.length > 120 || !subject || subject.length > 120 || !Number.isInteger(input.price) || input.price < 0 || input.price > 10000000 || !Number.isInteger(input.lessons) || input.lessons < 0 || input.lessons > 1000 || notes.length > 500) return { ok: false, message: "Проверьте данные строки." };
  const { data, error } = await ctx.admin.from("weekly_payment_rows").update({ student_name: studentName, subject, price_per_lesson_kzt: input.price, lessons_count: input.lessons, notes: notes || null, updated_at: new Date().toISOString() }).eq("id", rowId).eq("owner_admin_id", ctx.id).select("id").maybeSingle();
  if (error || !data) return { ok: false, message: "Не удалось сохранить строку." };
  refresh();
  return { ok: true, message: "Сохранено." };
}

export async function setWeeklyPaymentPaid(rowId: string, paid: boolean): Promise<Result> {
  const ctx = await context();
  if (!ctx || !uuid.test(rowId) || typeof paid !== "boolean") return { ok: false, message: "Некорректная строка." };
  const { data, error } = await ctx.admin.rpc("set_weekly_payment_paid_atomic", { p_owner_admin_id: ctx.id, p_row_id: rowId, p_paid: paid });
  if (error || (data as { status?: string } | null)?.status !== "saved") return { ok: false, message: "Не удалось изменить оплату." };
  refresh();
  return { ok: true, message: paid ? "Оплата отмечена." : "Отметка оплаты снята." };
}

export async function deleteWeeklyPaymentRow(rowId: string): Promise<Result> {
  const ctx = await context();
  if (!ctx || !uuid.test(rowId)) return { ok: false, message: "Некорректная строка." };
  const { data, error } = await ctx.admin.from("weekly_payment_rows").delete().eq("id", rowId).eq("owner_admin_id", ctx.id).select("id").maybeSingle();
  if (error || !data) return { ok: false, message: "Строка не найдена." };
  refresh();
  return { ok: true, message: "Строка удалена." };
}

export async function copyPreviousWeek(weekStart: string): Promise<Result> {
  const ctx = await context();
  if (!ctx || !isMonday(weekStart)) return { ok: false, message: "Некорректная неделя." };
  const { data, error } = await ctx.admin.rpc("copy_previous_weekly_payments_atomic", { p_owner_admin_id: ctx.id, p_week_start: weekStart });
  const result = data as { status?: string; count?: number } | null;
  if (error) return { ok: false, message: "Не удалось скопировать прошлую неделю." };
  if (result?.status === "target_not_empty") return { ok: false, message: "В выбранной неделе уже есть строки." };
  if (result?.status !== "copied") return { ok: false, message: "Не удалось скопировать прошлую неделю." };
  refresh();
  return { ok: true, message: result.count ? `Скопировано строк: ${result.count}.` : "В прошлой неделе нет строк." };
}
