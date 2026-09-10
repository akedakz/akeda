"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateProblem, parseTrainerImport, type GeneratedProblem, type TrainerDefinition } from "@/lib/trainers/trainer-import";
import { fingerprintTrainerSkill } from "@/lib/trainers/trainer-progress";

type Target = { trainerId: string; expectedRevision: number; skillKey: string; variantKey: string };
type MutationResult = { ok: true; revision: number } | { ok: false; message: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function context(target: Target) {
  const current = await getCurrentProfile();
  if (current?.profile?.role !== "ADMIN" || !uuid.test(target.trainerId) || !Number.isSafeInteger(target.expectedRevision) || target.expectedRevision < 1) return null;
  const db = createAdminClient();
  const result = await db.from("trainers").select("definition,content_revision").eq("id", target.trainerId).eq("owner_admin_id", current.profile.id).eq("type", "QUICK_PROBLEMS").maybeSingle();
  if (result.error || !result.data) return null;
  return { db, adminId: current.profile.id, definition: result.data.definition as TrainerDefinition, revision: result.data.content_revision as number };
}

function variantOf(definition: TrainerDefinition, target: Target) {
  return definition.skills.find((skill) => skill.key === target.skillKey)?.variants.find((variant) => variant.key === target.variantKey);
}

function validate(definition: TrainerDefinition) {
  const parsed = parseTrainerImport(JSON.stringify(definition), 0);
  return parsed.ok ? { definition: parsed.value.definition } : { message: parsed.errors[0]?.replace(/^skills\[\d+\]\.variants\[\d+\]\.prompts\[\d+\]:\s*/, "") ?? "Условие не прошло проверку." };
}

async function save(target: Target, oldDefinition: TrainerDefinition, definition: TrainerDefinition): Promise<MutationResult> {
  const loaded = await context(target);
  if (!loaded) return { ok: false, message: "Тренажёр не найден или недоступен." };
  if (loaded.revision !== target.expectedRevision) return { ok: false, message: "Контент уже изменён в другой вкладке. Обновите страницу." };
  const checked = validate(definition);
  if (!checked.definition) return { ok: false, message: checked.message! };
  const oldSkill = oldDefinition.skills.find((skill) => skill.key === target.skillKey);
  const newSkill = checked.definition.skills.find((skill) => skill.key === target.skillKey);
  if (!oldSkill || !newSkill) return { ok: false, message: "Формула не найдена." };
  const mutation = await loaded.db.rpc("mutate_quick_problem_prompts_atomic", {
    p_owner_admin_id: loaded.adminId,
    p_trainer_id: target.trainerId,
    p_expected_content_revision: target.expectedRevision,
    p_skill_key: target.skillKey,
    p_variant_key: target.variantKey,
    p_old_definition: oldDefinition,
    p_new_definition: checked.definition,
    p_old_fingerprint: fingerprintTrainerSkill(oldSkill),
    p_new_fingerprint: fingerprintTrainerSkill(newSkill),
  });
  if (mutation.error) return { ok: false, message: "Не удалось сохранить условие." };
  const result = mutation.data as { status?: string; content_revision?: number } | null;
  if (result?.status === "stale_trainer") return { ok: false, message: "Контент уже изменён в другой вкладке. Обновите страницу." };
  if (!(["updated", "unchanged"].includes(result?.status ?? "")) || typeof result?.content_revision !== "number") return { ok: false, message: "Изменение не прошло проверку безопасности." };
  const revision = result.content_revision;
  revalidatePath(`/admin/trainers/quick-problems/${target.trainerId}`);
  revalidatePath("/admin/trainers/quick-problems");
  return { ok: true, revision };
}

export async function updateCondition(target: Target, promptIndex: number, prompt: string): Promise<MutationResult> {
  const loaded = await context(target);
  if (!loaded || loaded.revision !== target.expectedRevision) return { ok: false, message: loaded ? "Контент уже изменён в другой вкладке. Обновите страницу." : "Тренажёр не найден или недоступен." };
  const oldDefinition = structuredClone(loaded.definition);
  const variant = variantOf(loaded.definition, target);
  if (!variant || !Number.isInteger(promptIndex) || promptIndex < 0 || promptIndex >= variant.prompts.length) return { ok: false, message: "Условие не найдено." };
  variant.prompts[promptIndex] = prompt;
  return save(target, oldDefinition, loaded.definition);
}

export async function addCondition(target: Target, prompt: string): Promise<MutationResult> {
  const loaded = await context(target);
  if (!loaded || loaded.revision !== target.expectedRevision) return { ok: false, message: loaded ? "Контент уже изменён в другой вкладке. Обновите страницу." : "Тренажёр не найден или недоступен." };
  const oldDefinition = structuredClone(loaded.definition);
  const variant = variantOf(loaded.definition, target);
  if (!variant) return { ok: false, message: "Тип задачи не найден." };
  variant.prompts.push(prompt);
  return save(target, oldDefinition, loaded.definition);
}

export async function deleteCondition(target: Target, promptIndex: number): Promise<MutationResult> {
  const loaded = await context(target);
  if (!loaded || loaded.revision !== target.expectedRevision) return { ok: false, message: loaded ? "Контент уже изменён в другой вкладке. Обновите страницу." : "Тренажёр не найден или недоступен." };
  const oldDefinition = structuredClone(loaded.definition);
  const variant = variantOf(loaded.definition, target);
  if (!variant || !Number.isInteger(promptIndex) || promptIndex < 0 || promptIndex >= variant.prompts.length) return { ok: false, message: "Условие не найдено." };
  if (variant.prompts.length === 1) return { ok: false, message: "У формулы должно остаться хотя бы одно условие." };
  variant.prompts.splice(promptIndex, 1);
  return save(target, oldDefinition, loaded.definition);
}

export async function previewCondition(target: Target, prompt: string): Promise<{ ok: true; problem: GeneratedProblem } | { ok: false; message: string }> {
  const loaded = await context(target);
  if (!loaded) return { ok: false, message: "Тренажёр не найден или недоступен." };
  const variant = variantOf(loaded.definition, target);
  if (!variant) return { ok: false, message: "Тип задачи не найден." };
  const draft = { ...variant, prompts: [prompt] };
  const definition = { ...loaded.definition, skills: loaded.definition.skills.map((skill) => skill.key === target.skillKey ? { ...skill, variants: skill.variants.map((item) => item.key === target.variantKey ? draft : item) } : skill) };
  const checked = validate(definition);
  if (!("definition" in checked)) return { ok: false, message: checked.message };
  try { return { ok: true, problem: generateProblem(draft) }; } catch { return { ok: false, message: "Не удалось сгенерировать корректный пример." }; }
}
