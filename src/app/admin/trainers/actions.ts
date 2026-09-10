"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  parseTrainerImport,
  parseTrainerSkillsImport,
  toClientSafeTrainerPreview,
  toClientSafeTrainerSkillsPreview,
  type TrainerPreview,
  type TrainerSkill,
  type TrainerSkillsPreview,
  TRAINER_LIMITS,
} from "@/lib/trainers/trainer-import";

type PreviewResult = { ok: true; preview: TrainerPreview } | { ok: false; message: string; errors?: string[] };
type SkillsPreviewResult = { ok: true; preview: TrainerSkillsPreview } | { ok: false; message: string; errors?: string[] };
type ActionResult = { ok: true; message: string; trainerId?: string } | { ok: false; message: string; errors?: string[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function adminContext() {
  const current = await getCurrentProfile();
  return current?.profile?.role === "ADMIN" ? { adminId: current.profile.id, db: createAdminClient() } : null;
}

export async function previewTrainerImport(raw: string): Promise<PreviewResult> {
  const context = await adminContext();
  if (!context) return { ok: false, message: "Недостаточно прав для предпросмотра тренажёра." };
  const parsed = parseTrainerImport(raw, 3);
  return parsed.ok ? { ok: true, preview: toClientSafeTrainerPreview(parsed.value) } : { ok: false, message: "Исправьте ошибки в JSON.", errors: parsed.errors };
}

export async function createTrainerFromImport(raw: string, groupId: string | null = null): Promise<ActionResult> {
  const context = await adminContext();
  if (!context) return { ok: false, message: "Недостаточно прав для импорта тренажёра." };
  const parsed = parseTrainerImport(raw, 0);
  if (!parsed.ok) return { ok: false, message: "Повторная серверная проверка не пройдена.", errors: parsed.errors };
  const definition = parsed.value.definition;
  if (groupId && !uuid.test(groupId)) return { ok: false, message: "Некорректная тема." };
  if (groupId) { const group=await context.db.from("trainer_groups").select("id").eq("id",groupId).eq("owner_admin_id",context.adminId).eq("trainer_type","QUICK_PROBLEMS").maybeSingle(); if(group.error||!group.data)return{ok:false,message:"Тема не найдена."}; }
  const { data, error } = await context.db.from("trainers").insert({
    owner_admin_id: context.adminId,
    type: definition.type,
    title: definition.title,
    description: definition.description,
    definition,
    group_id: groupId,
  }).select("id").single();
  if (error) {
    if (error.code === "23505") return { ok: false, message: "Тренажёр с таким названием уже существует." };
    console.error("Не удалось импортировать тренажёр:", { code: error.code, message: error.message, details: error.details, hint: error.hint });
    return { ok: false, message: "Не удалось создать тренажёр." };
  }
  revalidatePath("/admin/trainers/quick-problems");
  return { ok: true, message: "Тренажёр создан.", trainerId: data.id as string };
}

function existingSkills(definition: unknown): TrainerSkill[] {
  if (typeof definition !== "object" || definition === null || !("skills" in definition)) return [];
  return Array.isArray(definition.skills) ? definition.skills as TrainerSkill[] : [];
}

function skillConflicts(currentSkills: TrainerSkill[], incomingSkills: TrainerSkill[]): string[] {
  const currentKeys = new Set(currentSkills.map((skill) => skill.key));
  return incomingSkills.filter((skill) => currentKeys.has(skill.key)).map((skill) => `Формула с key "${skill.key}" уже существует в этом тренажёре.`);
}

function mergedDefinitionRaw(currentDefinition: unknown, incomingSkills: TrainerSkill[]): string {
  if (typeof currentDefinition !== "object" || currentDefinition === null || Array.isArray(currentDefinition)) return "null";
  return JSON.stringify({ ...currentDefinition, skills: [...existingSkills(currentDefinition), ...incomingSkills] });
}

export async function previewTrainerSkillsImport(trainerId: string, expectedRevision: number, raw: string): Promise<SkillsPreviewResult> {
  const context = await adminContext();
  if (!context) return { ok: false, message: "Недостаточно прав для предпросмотра формул." };
  if (!uuid.test(trainerId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) return { ok: false, message: "Некорректные данные тренажёра." };
  const current = await context.db.from("trainers").select("definition,content_revision").eq("id", trainerId).eq("owner_admin_id", context.adminId).eq("type", "QUICK_PROBLEMS").maybeSingle();
  if (current.error) return { ok: false, message: "Не удалось загрузить тренажёр." };
  if (!current.data) return { ok: false, message: "Тренажёр не найден." };
  if (current.data.content_revision !== expectedRevision) return { ok: false, message: "Тренажёр уже был изменён. Обновите страницу и повторите импорт." };
  const parsed = parseTrainerSkillsImport(raw, 3);
  if (!parsed.ok) return { ok: false, message: "Исправьте ошибки в JSON.", errors: parsed.errors };
  const conflicts = skillConflicts(existingSkills(current.data.definition), parsed.value.skills);
  if (conflicts.length) return { ok: false, message: "Найдены повторяющиеся формулы.", errors: conflicts };
  const merged = parseTrainerImport(mergedDefinitionRaw(current.data.definition, parsed.value.skills), 0);
  if (!merged.ok) return { ok: false, message: "Итоговый тренажёр не прошёл проверку.", errors: merged.errors };
  return { ok: true, preview: toClientSafeTrainerSkillsPreview(parsed.value) };
}

export async function addTrainerSkillsFromImport(trainerId: string, expectedRevision: number, raw: string): Promise<ActionResult> {
  const context = await adminContext();
  if (!context) return { ok: false, message: "Недостаточно прав для добавления формул." };
  if (!uuid.test(trainerId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) return { ok: false, message: "Некорректные данные тренажёра." };
  const current = await context.db.from("trainers").select("definition,content_revision").eq("id", trainerId).eq("owner_admin_id", context.adminId).eq("type", "QUICK_PROBLEMS").maybeSingle();
  if (current.error) return { ok: false, message: "Не удалось загрузить тренажёр." };
  if (!current.data) return { ok: false, message: "Тренажёр не найден." };
  if (current.data.content_revision !== expectedRevision) return { ok: false, message: "Тренажёр уже был изменён. Обновите страницу и повторите импорт." };
  const parsed = parseTrainerSkillsImport(raw, 0);
  if (!parsed.ok) return { ok: false, message: "Повторная серверная проверка не пройдена.", errors: parsed.errors };
  const conflicts = skillConflicts(existingSkills(current.data.definition), parsed.value.skills);
  if (conflicts.length) return { ok: false, message: "Найдены повторяющиеся формулы.", errors: conflicts };
  const merged = parseTrainerImport(mergedDefinitionRaw(current.data.definition, parsed.value.skills), 0);
  if (!merged.ok) return { ok: false, message: "Итоговый тренажёр не прошёл проверку.", errors: merged.errors };
  const updated = await context.db.from("trainers").update({ definition: merged.value.definition, content_revision: expectedRevision + 1, updated_at: new Date().toISOString() }).eq("id", trainerId).eq("owner_admin_id", context.adminId).eq("type", "QUICK_PROBLEMS").eq("content_revision", expectedRevision).select("id").maybeSingle();
  if (updated.error) return { ok: false, message: "Не удалось добавить формулы." };
  if (!updated.data) return { ok: false, message: "Тренажёр уже был изменён. Обновите страницу и повторите импорт." };
  revalidatePath("/admin/trainers/quick-problems");
  return { ok: true, message: "Формулы добавлены.", trainerId: updated.data.id as string };
}

export async function renameTrainer(trainerId: string, title: string): Promise<ActionResult> {
  const context = await adminContext();
  if (!context) return { ok: false, message: "Недостаточно прав для переименования тренажёра." };
  if (!uuid.test(trainerId)) return { ok: false, message: "Некорректный идентификатор тренажёра." };
  if (typeof title !== "string") return { ok: false, message: "Введите название тренажёра." };
  const normalizedTitle = title.trim();
  if (!normalizedTitle) return { ok: false, message: "Название не может быть пустым." };
  if (normalizedTitle.length > TRAINER_LIMITS.title) return { ok: false, message: `Название должно содержать не более ${TRAINER_LIMITS.title} символов.` };
  const current = await context.db.from("trainers").select("title").eq("id", trainerId).eq("owner_admin_id", context.adminId).eq("type", "QUICK_PROBLEMS").maybeSingle();
  if (current.error) return { ok: false, message: "Не удалось загрузить тренажёр." };
  if (!current.data) return { ok: false, message: "Тренажёр не найден." };
  if (current.data.title.trim() === normalizedTitle) return { ok: true, message: "Название не изменилось.", trainerId };
  const updated = await context.db.from("trainers").update({ title: normalizedTitle, updated_at: new Date().toISOString() }).eq("id", trainerId).eq("owner_admin_id", context.adminId).eq("type", "QUICK_PROBLEMS").select("id").maybeSingle();
  if (updated.error?.code === "23505") return { ok: false, message: "Тренажёр с таким названием уже существует." };
  if (updated.error) return { ok: false, message: "Не удалось сохранить название." };
  if (!updated.data) return { ok: false, message: "Тренажёр не найден." };
  revalidatePath("/admin/trainers/quick-problems");
  return { ok: true, message: "Название сохранено.", trainerId };
}

export async function deleteTrainer(trainerId: string): Promise<ActionResult> {
  const context = await adminContext();
  if (!context) return { ok: false, message: "Недостаточно прав для удаления тренажёра." };
  if (!uuid.test(trainerId)) return { ok: false, message: "Некорректный идентификатор тренажёра." };
  const { data, error } = await context.db.from("trainers").delete().eq("id", trainerId).eq("owner_admin_id", context.adminId).select("id").maybeSingle();
  if (error) {
    console.error("Не удалось удалить тренажёр:", { code: error.code, message: error.message, details: error.details, hint: error.hint });
    return { ok: false, message: "Не удалось удалить тренажёр." };
  }
  if (!data) return { ok: false, message: "Тренажёр не найден или уже удалён." };
  revalidatePath("/admin/trainers/quick-problems");
  return { ok: true, message: "Тренажёр удалён." };
}
