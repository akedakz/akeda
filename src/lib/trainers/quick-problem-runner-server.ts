import { inactiveTrainerResult } from "./student-access";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateProblem, type TrainerDefinition, type TrainerSkill, type TrainerVariant } from "./trainer-import";
import { fingerprintTrainerSkill } from "./trainer-progress";

export type RunnerTaskPacket = { id: string; prompt: string; answerUnit: string; skillKey: string; skillName: string; variantKey: string; contentRevision: number; mode: "NORMAL" | "HINT"; formulaLatex: string; answerSalt: string; answerCommitment: string };
export type NormalTaskBundle = { task: RunnerTaskPacket; retries: RunnerTaskPacket[] };
export type RunnerSnapshot = { assignmentId: string; trainerTitle: string; contentRevision: number; skillsCount: number; creditedTotal: number; creditedBySkill: Record<string, number>; progressPercent: number; storageScope: string };
type Context = { assignment: { id: string; trainer_id: string; owner_admin_id: string }; trainer: { id: string; title: string; type: string; content_revision: number; definition: TrainerDefinition }; credited: Map<string, number> };
type TaskInsert = { id: string; assignment_id: string; mode: "NORMAL" | "HINT"; skill_key: string; skill_fingerprint: string; variant_key: string; content_revision: number; prompt: string; answer_unit: string; expected_answer: number };

async function loadContext(studentId: string, assignmentId: string): Promise<Context | null> {
  const db = createAdminClient();
  const assignmentResult = await db.from("trainer_assignments").select("id,trainer_id,owner_admin_id").eq("id", assignmentId).eq("student_id", studentId).maybeSingle();
  if (assignmentResult.error || !assignmentResult.data) return null;
  const trainerResult = await db.from("trainers").select("id,title,type,content_revision,definition").eq("id", assignmentResult.data.trainer_id).eq("owner_admin_id", assignmentResult.data.owner_admin_id).eq("type", "QUICK_PROBLEMS").maybeSingle();
  if (trainerResult.error || !trainerResult.data) return null;
  const progressResult = await db.from("trainer_assignment_skill_progress").select("skill_key,skill_fingerprint,credited_correct").eq("assignment_id", assignmentId);
  if (progressResult.error) return null;
  const trainer = trainerResult.data as Context["trainer"];
  const fingerprints = new Map(trainer.definition.skills.map((skill) => [skill.key, fingerprintTrainerSkill(skill)]));
  const credited = new Map<string, number>();
  for (const row of progressResult.data ?? []) if (fingerprints.get(row.skill_key) === row.skill_fingerprint) credited.set(row.skill_key, Math.min(5, Math.max(0, row.credited_correct)));
  return { assignment: assignmentResult.data as Context["assignment"], trainer, credited };
}

function packetAndInsert(context: Context, skill: TrainerSkill, variant: TrainerVariant, mode: "NORMAL" | "HINT", previousPrompt?: string): { packet: RunnerTaskPacket; insert: TaskInsert } {
  let problem = generateProblem(variant);
  for (let attempt = 0; attempt < 8 && problem.prompt === previousPrompt; attempt += 1) problem = generateProblem(variant);
  const id = randomUUID(); const answerSalt = randomBytes(16).toString("hex");
  const answerCommitment = createHash("sha256").update(`${answerSalt}:${problem.answer}`, "utf8").digest("hex");
  return {
    packet: { id, prompt: problem.prompt, answerUnit: problem.answerUnit, skillKey: skill.key, skillName: skill.name, variantKey: variant.key, contentRevision: context.trainer.content_revision, mode, formulaLatex: skill.formulaLatex, answerSalt, answerCommitment },
    insert: { id, assignment_id: context.assignment.id, mode, skill_key: skill.key, skill_fingerprint: fingerprintTrainerSkill(skill), variant_key: variant.key, content_revision: context.trainer.content_revision, prompt: problem.prompt, answer_unit: problem.answerUnit, expected_answer: problem.answer },
  };
}

function randomItem<T>(items: T[]): T { return items[Math.floor(Math.random() * items.length)]; }

export function createQuickProblemPreviewSession(trainerId: string, title: string, contentRevision: number, definition: TrainerDefinition) {
  const context: Context = { assignment: { id: trainerId, trainer_id: trainerId, owner_admin_id: trainerId }, trainer: { id: trainerId, title, type: "QUICK_PROBLEMS", content_revision: contentRevision, definition }, credited: new Map() };
  const bundles: NormalTaskBundle[] = [];
  for (let round = 0; round < 6; round += 1) for (const skill of definition.skills) {
    const variant = randomItem(skill.variants); const normal = packetAndInsert(context, skill, variant, "NORMAL");
    const retries: RunnerTaskPacket[] = []; let previousPrompt = normal.packet.prompt;
    for (let retry = 0; retry < 3; retry += 1) { const hint = packetAndInsert(context, skill, variant, "HINT", previousPrompt); retries.push(hint.packet); previousPrompt = hint.packet.prompt; }
    bundles.push({ task: normal.packet, retries });
  }
  const snapshot: RunnerSnapshot = { assignmentId: trainerId, trainerTitle: title, contentRevision, skillsCount: definition.skills.length, creditedTotal: 0, creditedBySkill: Object.fromEntries(definition.skills.map((skill) => [skill.key, 0])), progressPercent: 0, storageScope: "preview" };
  return { snapshot, bundles };
}

export async function issueNormalTaskBatch(studentId: string, assignmentId: string, count = 8): Promise<{ snapshot: RunnerSnapshot; bundles: NormalTaskBundle[] } | ReturnType<typeof inactiveTrainerResult> | null> {
  const context = await loadContext(studentId, assignmentId); if (!context) return null;
  const active = context.trainer.definition.skills.filter((skill) => (context.credited.get(skill.key) ?? 0) < 5); if (!active.length) return null;
  const db = createAdminClient();
  const latest = await db.from("trainer_quick_problem_tasks").select("skill_key").eq("assignment_id", assignmentId).eq("mode", "NORMAL").order("issued_sequence", { ascending: false }).limit(1).maybeSingle();
  let previousSkill = latest.data?.skill_key ?? null;
  const inserts: TaskInsert[] = []; const bundles: NormalTaskBundle[] = [];
  for (let index = 0; index < count; index += 1) {
    const choices = active.length > 1 ? active.filter((skill) => skill.key !== previousSkill) : active;
    const skill = randomItem(choices); const variant = randomItem(skill.variants);
    const normal = packetAndInsert(context, skill, variant, "NORMAL"); inserts.push(normal.insert);
    const retries: RunnerTaskPacket[] = []; let previousPrompt = normal.packet.prompt;
    for (let retry = 0; retry < 3; retry += 1) { const hint = packetAndInsert(context, skill, variant, "HINT", previousPrompt); inserts.push(hint.insert); retries.push(hint.packet); previousPrompt = hint.packet.prompt; }
    bundles.push({ task: normal.packet, retries }); previousSkill = skill.key;
  }
  const inserted = await db.from("trainer_quick_problem_tasks").insert(inserts);
  if (inserted.error?.code === "PT403" && inserted.error.message === "student_inactive") return inactiveTrainerResult();
  if (inserted.error) { console.error("Не удалось подготовить очередь тренажёра:", inserted.error); return null; }
  const creditedTotal = [...context.credited.values()].reduce((sum, value) => sum + value, 0);
  const creditedBySkill = Object.fromEntries(context.trainer.definition.skills.map((skill) => [skill.key, context.credited.get(skill.key) ?? 0]));
  return { snapshot: { assignmentId, trainerTitle: context.trainer.title, contentRevision: context.trainer.content_revision, skillsCount: context.trainer.definition.skills.length, creditedTotal, creditedBySkill, progressPercent: Math.round(creditedTotal / (context.trainer.definition.skills.length * 5) * 100), storageScope: createHash("sha256").update(studentId, "utf8").digest("hex").slice(0, 24) }, bundles };
}

export async function issueHintTaskBatch(studentId: string, assignmentId: string, sourceTaskId: string, count = 4): Promise<RunnerTaskPacket[] | ReturnType<typeof inactiveTrainerResult> | null> {
  const context = await loadContext(studentId, assignmentId); if (!context) return null;
  const db = createAdminClient();
  const sourceResult = await db.from("trainer_quick_problem_tasks").select("skill_key,variant_key,prompt,consumed_at,result_correct,content_revision").eq("id", sourceTaskId).eq("assignment_id", assignmentId).maybeSingle();
  const source = sourceResult.data;
  if (sourceResult.error || !source || !source.consumed_at || source.result_correct !== false || source.content_revision !== context.trainer.content_revision) return null;
  const skill = context.trainer.definition.skills.find((item) => item.key === source.skill_key); const variant = skill?.variants.find((item) => item.key === source.variant_key);
  if (!skill || !variant) return null;
  const inserts: TaskInsert[] = []; const packets: RunnerTaskPacket[] = []; let previousPrompt = source.prompt;
  for (let index = 0; index < count; index += 1) { const generated = packetAndInsert(context, skill, variant, "HINT", previousPrompt); inserts.push(generated.insert); packets.push(generated.packet); previousPrompt = generated.packet.prompt; }
  const inserted = await db.from("trainer_quick_problem_tasks").insert(inserts); if (inserted.error?.code === "PT403" && inserted.error.message === "student_inactive") return inactiveTrainerResult();
  if (inserted.error) return null;
  return packets;
}

export async function currentFingerprintMap(studentId: string, assignmentId: string) {
  const context = await loadContext(studentId, assignmentId); if (!context) return null;
  return { revision: context.trainer.content_revision, fingerprints: Object.fromEntries(context.trainer.definition.skills.map((skill) => [skill.key, fingerprintTrainerSkill(skill)])) };
}
