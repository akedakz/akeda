"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseTheoryImport, validateTheoryDefinition } from "@/lib/trainers/theory-import";
import type { TheoryQuestion } from "@/lib/trainers/theory-types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Result = { ok: true; message: string; trainerId?: string; definition?: unknown; contentRevision?: number } | { ok: false; message: string; errors?: string[] };

async function context() {
  const current = await getCurrentProfile();
  if (!current || current.profile?.role !== "ADMIN") return null;
  return { adminId: current.profile.id, db: createAdminClient() };
}
function importShape(title: unknown, questions: unknown) { return { version: "NSP_THEORY_IMPORT_V1", title, questions: Array.isArray(questions) ? questions.map((question) => { const value = question as Partial<TheoryQuestion>; return { key: value.key, text: value.text, options: value.options, correctOption: value.correctOption, explanation: value.explanation }; }) : questions }; }

export async function previewTheoryImport(raw: string): Promise<Result> {
  if (!await context()) return { ok: false, message: "Недостаточно прав." };
  const parsed = parseTheoryImport(raw);
  return parsed.ok ? { ok: true, message: "Импорт прошёл проверку.", definition: parsed.value.definition } : { ok: false, message: "Исправьте ошибки импорта.", errors: parsed.errors };
}

export async function createTheoryDraft(raw: string, groupId: string | null = null): Promise<Result> {
  const auth = await context();
  if (!auth) return { ok: false, message: "Недостаточно прав." };
  const parsed = parseTheoryImport(raw);
  if (!parsed.ok) return { ok: false, message: "Импорт не прошёл повторную проверку.", errors: parsed.errors };
  if(groupId&&!uuid.test(groupId))return{ok:false,message:"Некорректная тема."};
  if(groupId){const group=await auth.db.from("trainer_groups").select("id").eq("id",groupId).eq("owner_admin_id",auth.adminId).eq("trainer_type","THEORY").maybeSingle();if(group.error||!group.data)return{ok:false,message:"Тема не найдена."};}
  const { data, error } = await auth.db.from("trainers").insert({ owner_admin_id: auth.adminId, type: "THEORY", title: parsed.value.definition.title, description: "", definition: parsed.value.definition, status: "DRAFT",group_id:groupId }).select("id").single();
  if (error || !data) return { ok: false, message: error?.code === "23505" ? "Theory с таким названием уже существует." : "Не удалось создать черновик. Убедитесь, что migration Theory применена." };
  revalidatePath("/admin/trainers/theory");
  return { ok: true, message: "Черновик создан.", trainerId: data.id };
}

export async function saveTheoryTrainer(trainerId: string, expectedRevision: number, title: string, questions: TheoryQuestion[]): Promise<Result> {
  const auth = await context();
  if (!auth || !uuid.test(trainerId) || !Number.isInteger(expectedRevision) || expectedRevision < 1) return { ok: false, message: "Некорректные данные сохранения." };
  const parsed = validateTheoryDefinition(importShape(title, questions));
  if (!parsed.ok) return { ok: false, message: parsed.errors[0], errors: parsed.errors };
  const { data, error } = await auth.db.rpc("save_theory_trainer_atomic", { p_owner_admin_id: auth.adminId, p_trainer_id: trainerId, p_expected_revision: expectedRevision, p_title: parsed.value.definition.title, p_definition: parsed.value.definition });
  const saved = data as { status?: string; content_revision?: number } | null;
  if (error || saved?.status !== "saved") return { ok: false, message: error?.code === "23505" ? "Theory с таким названием уже существует." : "Не удалось сохранить: запись изменилась или runtime migration не применена." };
  revalidatePath(`/admin/trainers/theory/${trainerId}`); revalidatePath("/admin/trainers/theory");
  return { ok: true, message: "Theory сохранён.", definition: parsed.value.definition, contentRevision: saved.content_revision };
}

export async function publishTheoryTrainer(trainerId: string): Promise<Result> {
  const auth = await context();
  if (!auth || !uuid.test(trainerId)) return { ok: false, message: "Недостаточно прав." };
  const current = await auth.db.from("trainers").select("title,definition,status").eq("id", trainerId).eq("owner_admin_id", auth.adminId).eq("type", "THEORY").maybeSingle();
  if (current.error || !current.data) return { ok: false, message: "Theory не найден." };
  const definition = current.data.definition as { questions?: unknown };
  const parsed = validateTheoryDefinition(importShape(current.data.title, definition.questions));
  if (!parsed.ok) return { ok: false, message: parsed.errors[0], errors: parsed.errors };
  const result = await auth.db.from("trainers").update({ status: "PUBLISHED", updated_at: new Date().toISOString() }).eq("id", trainerId).eq("owner_admin_id", auth.adminId).eq("type", "THEORY").eq("status", "DRAFT").select("id").maybeSingle();
  if (result.error || !result.data) return { ok: false, message: current.data.status === "PUBLISHED" ? "Theory уже опубликован." : "Не удалось опубликовать Theory." };
  revalidatePath(`/admin/trainers/theory/${trainerId}`); revalidatePath("/admin/trainers/theory");
  return { ok: true, message: "Theory опубликован." };
}

export async function renameTheoryTrainer(trainerId: string, title: string): Promise<Result> {
  const auth = await context(); const normalized = title.trim();
  if (!auth || !uuid.test(trainerId) || !normalized || normalized.length > 120) return { ok: false, message: "Некорректное название." };
  const result = await auth.db.from("trainers").update({ title: normalized, updated_at: new Date().toISOString() }).eq("id", trainerId).eq("owner_admin_id", auth.adminId).eq("type", "THEORY").select("id").maybeSingle();
  if (result.error || !result.data) return { ok: false, message: result.error?.code === "23505" ? "Theory с таким названием уже существует." : "Не удалось переименовать Theory." };
  revalidatePath("/admin/trainers/theory"); revalidatePath(`/admin/trainers/theory/${trainerId}`);
  return { ok: true, message: "Theory переименован." };
}

export async function deleteTheoryTrainer(trainerId: string, confirmation: string): Promise<Result> {
  const auth = await context();
  if (!auth || !uuid.test(trainerId) || confirmation !== "DELETE") return { ok: false, message: "Введите DELETE для подтверждения." };
  const result = await auth.db.from("trainers").delete().eq("id", trainerId).eq("owner_admin_id", auth.adminId).eq("type", "THEORY").select("id").maybeSingle();
  if (result.error || !result.data) return { ok: false, message: "Theory не найден или недоступен." };
  revalidatePath("/admin/trainers/theory");
  return { ok: true, message: "Theory удалён." };
}
