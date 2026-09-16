"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: boolean; message: string };
export type PendingKaspiPaymentClaim = { id: string; amountKzt: number; createdAt: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function parentChildContext(studentId: string) {
  const current = await getCurrentProfile();
  if (!current?.profile || current.profile.role !== "PARENT" || !uuid.test(studentId)) return null;

  const admin = createAdminClient();
  const child = await admin
    .from("profiles")
    .select("id")
    .eq("id", studentId)
    .eq("role", "STUDENT")
    .eq("parent_id", current.profile.id)
    .maybeSingle();

  if (child.error || !child.data) return null;
  return { parentId: current.profile.id, admin };
}

export async function submitKaspiPaymentClaim(studentId: string, amountKzt: number): Promise<Result> {
  const context = await parentChildContext(studentId);
  if (!context) return { ok: false, message: "Недостаточно прав." };
  if (!Number.isInteger(amountKzt) || amountKzt < 1 || amountKzt > 1_000_000_000) {
    return { ok: false, message: "Введите корректную сумму оплаты." };
  }

  const result = await context.admin
    .from("student_payment_claims")
    .insert({ student_id: studentId, reported_by: context.parentId, amount_kzt: amountKzt })
    .select("id")
    .single();

  if (result.error || !result.data) {
    return { ok: false, message: "Не удалось отправить заявку об оплате." };
  }

  revalidatePath("/parent");
  revalidatePath("/admin/payments");
  return { ok: true, message: "Заявка отправлена. После проверки она появится в балансе." };
}

export async function loadPendingKaspiPaymentClaims(studentId: string): Promise<PendingKaspiPaymentClaim[] | null> {
  const context = await parentChildContext(studentId);
  if (!context) return null;

  const result = await context.admin
    .from("student_payment_claims")
    .select("id,amount_kzt,created_at")
    .eq("student_id", studentId)
    .eq("reported_by", context.parentId)
    .eq("status", "PENDING")
    .order("created_at", { ascending: false })
    .limit(20);

  if (result.error) return null;
  return (result.data ?? []).map((claim) => ({
    id: claim.id,
    amountKzt: Number(claim.amount_kzt),
    createdAt: claim.created_at,
  }));
}
