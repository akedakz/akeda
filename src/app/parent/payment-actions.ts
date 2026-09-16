"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: boolean; message: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function submitKaspiPaymentClaim(studentId: string, amountKzt: number): Promise<Result> {
  const current = await getCurrentProfile();
  if (!current?.profile || current.profile.role !== "PARENT" || !uuid.test(studentId)) {
    return { ok: false, message: "Недостаточно прав." };
  }
  if (!Number.isInteger(amountKzt) || amountKzt < 1 || amountKzt > 1_000_000_000) {
    return { ok: false, message: "Введите корректную сумму оплаты." };
  }

  const admin = createAdminClient();
  const child = await admin
    .from("profiles")
    .select("id")
    .eq("id", studentId)
    .eq("role", "STUDENT")
    .eq("parent_id", current.profile.id)
    .maybeSingle();

  if (child.error || !child.data) {
    return { ok: false, message: "Ученик не найден." };
  }

  const existing = await admin
    .from("student_payment_claims")
    .select("id")
    .eq("student_id", studentId)
    .eq("reported_by", current.profile.id)
    .eq("status", "PENDING")
    .maybeSingle();

  if (existing.error) return { ok: false, message: "Не удалось проверить предыдущую заявку." };

  const result = existing.data
    ? await admin
        .from("student_payment_claims")
        .update({ amount_kzt: amountKzt, created_at: new Date().toISOString() })
        .eq("id", existing.data.id)
        .eq("reported_by", current.profile.id)
        .eq("status", "PENDING")
        .select("id")
        .maybeSingle()
    : await admin
        .from("student_payment_claims")
        .insert({ student_id: studentId, reported_by: current.profile.id, amount_kzt: amountKzt })
        .select("id")
        .single();

  if (result.error || !result.data) {
    return { ok: false, message: "Не удалось отправить заявку об оплате." };
  }

  revalidatePath("/parent");
  revalidatePath("/admin/payments");
  return { ok: true, message: "Заявка отправлена. Оплата появится в балансе после подтверждения." };
}
