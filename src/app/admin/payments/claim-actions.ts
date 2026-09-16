"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: boolean; message: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function reviewKaspiPaymentClaim(
  claimId: string,
  decision: "CONFIRM" | "REJECT",
): Promise<Result> {
  const current = await getCurrentProfile();
  if (!current?.profile || current.profile.role !== "ADMIN" || !uuid.test(claimId)) {
    return { ok: false, message: "Недостаточно прав." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("review_student_payment_claim_atomic", {
    p_claim_id: claimId,
    p_admin_id: current.profile.id,
    p_decision: decision,
    p_review_note: null,
  });
  const result = data as { status?: string; student_id?: string } | null;
  if (error || !result || !["confirmed", "rejected"].includes(result.status ?? "")) {
    return { ok: false, message: "Не удалось обработать заявку." };
  }

  revalidatePath("/admin/payments");
  revalidatePath("/parent");
  if (result.student_id) revalidatePath(`/admin/students/${result.student_id}`);

  return {
    ok: true,
    message: decision === "CONFIRM" ? "Оплата подтверждена." : "Заявка отклонена.",
  };
}
