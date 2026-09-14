"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";

export type ParentFinanceActionResult = { ok: boolean; message: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function adminContext() {
  const current = await getCurrentProfile();
  return current?.profile?.role === "ADMIN" ? { id: current.profile.id, admin: createAdminClient() } : null;
}

function refresh(studentId: string) {
  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath("/parent");
}

async function studentExists(admin: ReturnType<typeof createAdminClient>, studentId: string) {
  const result = await admin.from("profiles").select("id").eq("id", studentId).eq("role", "STUDENT").maybeSingle();
  return !result.error && Boolean(result.data);
}

export async function linkExistingParent(studentId: string, formData: FormData): Promise<ParentFinanceActionResult> {
  const context = await adminContext();
  if (!context) return { ok: false, message: "Недостаточно прав." };
  const parentId = String(formData.get("parentId") ?? "");
  if (!uuid.test(studentId) || !uuid.test(parentId)) return { ok: false, message: "Выберите родителя." };
  const [studentOk, parent] = await Promise.all([
    studentExists(context.admin, studentId),
    context.admin.from("profiles").select("id").eq("id", parentId).eq("role", "PARENT").maybeSingle(),
  ]);
  if (!studentOk || parent.error || !parent.data) return { ok: false, message: "Ученик или родитель не найден." };
  const result = await context.admin.from("profiles").update({ parent_id: parentId }).eq("id", studentId).eq("role", "STUDENT").select("id").maybeSingle();
  if (result.error || !result.data) return { ok: false, message: "Не удалось привязать родителя." };
  refresh(studentId);
  return { ok: true, message: "Родитель привязан." };
}

export async function unlinkParent(studentId: string): Promise<ParentFinanceActionResult> {
  const context = await adminContext();
  if (!context || !uuid.test(studentId)) return { ok: false, message: "Недостаточно прав." };
  const result = await context.admin.from("profiles").update({ parent_id: null }).eq("id", studentId).eq("role", "STUDENT").select("id").maybeSingle();
  if (result.error || !result.data) return { ok: false, message: "Не удалось отвязать родителя." };
  refresh(studentId);
  return { ok: true, message: "Родитель отвязан. Аккаунт сохранён." };
}

export async function createParentAndLink(studentId: string, formData: FormData): Promise<ParentFinanceActionResult> {
  const context = await adminContext();
  if (!context || !uuid.test(studentId)) return { ok: false, message: "Недостаточно прав." };
  if (!(await studentExists(context.admin, studentId))) return { ok: false, message: "Ученик не найден." };
  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!fullName || fullName.length > 120) return { ok: false, message: "Введите имя родителя до 120 символов." };
  if (!emailPattern.test(email)) return { ok: false, message: "Введите корректный email." };
  if (password.length < 8) return { ok: false, message: "Пароль должен содержать не менее 8 символов." };

  const operation = crypto.randomUUID();
  const created = await context.admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
  if (created.error) {
    const duplicate = created.error.code === "email_exists" || /already (been )?registered|already exists/i.test(created.error.message);
    return { ok: false, message: duplicate ? "Пользователь с таким email уже существует." : "Не удалось создать родителя." };
  }
  const userId = created.data.user.id;
  const profile = await context.admin.from("profiles").upsert({ id: userId, email, full_name: fullName, role: "PARENT", student_status: null, parent_id: null }, { onConflict: "id" });
  const linked = profile.error ? null : await context.admin.from("profiles").update({ parent_id: userId }).eq("id", studentId).eq("role", "STUDENT").select("id").maybeSingle();
  if (profile.error || linked?.error || !linked?.data) {
    console.error("PARENT_CREATE_PROFILE_OR_LINK", { operation });
    const rollback = await context.admin.auth.admin.deleteUser(userId);
    return { ok: false, message: rollback.error ? "Родитель не привязан, а Auth-пользователя не удалось удалить. Проверьте Auth users." : "Не удалось создать профиль или связь. Auth-пользователь удалён; повторите операцию." };
  }
  refresh(studentId);
  return { ok: true, message: "Родитель создан и привязан." };
}

export async function setStudentFinanceRate(studentId: string, formData: FormData): Promise<ParentFinanceActionResult> {
  const context = await adminContext();
  const rate = Number(String(formData.get("rate") ?? ""));
  if (!context || !uuid.test(studentId)) return { ok: false, message: "Недостаточно прав." };
  if (!Number.isInteger(rate) || rate < 1 || rate > 100000000) return { ok: false, message: "Введите корректный тариф в тенге." };
  const result = await context.admin.rpc("set_student_finance_rate_atomic", { p_student_id: studentId, p_admin_id: context.id, p_rate_per_60_kzt: rate });
  if (result.error || (result.data as { status?: string } | null)?.status !== "saved") return { ok: false, message: "Не удалось сохранить тариф." };
  refresh(studentId);
  return { ok: true, message: "Тариф сохранён." };
}

export async function addStudentPayment(studentId: string, formData: FormData): Promise<ParentFinanceActionResult> {
  const context = await adminContext();
  const amount = Number(String(formData.get("amount") ?? ""));
  const note = String(formData.get("note") ?? "").trim();
  const operationKey = String(formData.get("operationKey") ?? "");
  if (!context || !uuid.test(studentId)) return { ok: false, message: "Недостаточно прав." };
  if (!Number.isInteger(amount) || amount < 1 || amount > 1000000000 || note.length > 500 || !uuid.test(operationKey)) return { ok: false, message: "Проверьте сумму и комментарий." };
  const result = await context.admin.rpc("add_student_financial_entry_atomic", { p_student_id: studentId, p_admin_id: context.id, p_entry_type: "PAYMENT", p_amount_kzt: amount, p_note: note || null, p_operation_key: operationKey });
  if (result.error || !["saved"].includes((result.data as { status?: string } | null)?.status ?? "")) return { ok: false, message: "Не удалось добавить оплату." };
  refresh(studentId);
  return { ok: true, message: "Оплата добавлена." };
}
