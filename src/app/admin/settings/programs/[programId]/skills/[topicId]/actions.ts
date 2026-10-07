"use server";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { generateSkillTasks } from "@/lib/programs/skill-generators.server";
import { normalizeNumericAnswer } from "@/lib/programs/section1-skill-generators";
import { createAdminClient } from "@/lib/supabase/admin";

type StartResult = {
  ok: boolean;
  message: string;
  attemptId?: string;
  tasks?: { id: string; position: number; prompt: string; difficulty: "BASIC" | "CORE" | "CHALLENGE" }[];
};

type SubmitResult = {
  ok: boolean;
  message: string;
  score?: number;
  total?: number;
  mastered?: boolean;
  results?: { taskId: string; correct: boolean; expectedAnswer: string }[];
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function context() {
  const current = await getCurrentProfile();
  return current?.profile?.role === "ADMIN"
    ? { profileId: current.profile.id, admin: createAdminClient() }
    : null;
}

export async function startSkillGeneratorPreview(programId: string, topicId: string): Promise<StartResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, message: "Недостаточно прав." };
  if (!uuid.test(programId) || !uuid.test(topicId)) return { ok: false, message: "Некорректный навык." };

  const [topic, generator] = await Promise.all([
    ctx.admin.from("learning_program_topics").select("id,program_id").eq("id", topicId).eq("program_id", programId).maybeSingle(),
    ctx.admin.from("learning_program_skill_generators").select("id,program_topic_id,generator_key,config").eq("program_topic_id", topicId).eq("is_active", true).maybeSingle(),
  ]);
  if (topic.error || !topic.data || generator.error || !generator.data) {
    return { ok: false, message: "Генератор навыка не найден." };
  }

  let generated;
  try {
    generated = generateSkillTasks(generator.data.generator_key, generator.data.config);
  } catch (error) {
    console.error("SKILL_GENERATOR_CREATE", error);
    return { ok: false, message: "Не удалось сгенерировать набор задач." };
  }

  const attempt = await ctx.admin.from("learning_skill_practice_attempts").insert({
    profile_id: ctx.profileId,
    program_topic_id: topicId,
    generator_id: generator.data.id,
    total_questions: generated.length,
  }).select("id").single();

  if (attempt.error || !attempt.data) return { ok: false, message: "Не удалось создать попытку." };

  const rows = generated.map((task, index) => ({
    attempt_id: attempt.data.id,
    position: index + 1,
    prompt: task.prompt,
    difficulty: task.difficulty,
    parameters: task.parameters,
    expected_answer: task.expectedAnswer,
  }));

  const inserted = await ctx.admin.from("learning_skill_practice_tasks")
    .insert(rows)
    .select("id,position,prompt,difficulty")
    .order("position");

  if (inserted.error) {
    await ctx.admin.from("learning_skill_practice_attempts").delete().eq("id", attempt.data.id);
    return { ok: false, message: "Не удалось сохранить задания попытки." };
  }

  return {
    ok: true,
    message: "Новый набор создан.",
    attemptId: attempt.data.id,
    tasks: (inserted.data ?? []).map((task) => ({
      id: task.id,
      position: task.position,
      prompt: task.prompt,
      difficulty: task.difficulty as "BASIC" | "CORE" | "CHALLENGE",
    })),
  };
}

export async function submitSkillGeneratorPreview(
  attemptId: string,
  answers: { taskId: string; answer: string }[],
): Promise<SubmitResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, message: "Недостаточно прав." };
  if (!uuid.test(attemptId) || !Array.isArray(answers)) return { ok: false, message: "Некорректная попытка." };

  const attempt = await ctx.admin.from("learning_skill_practice_attempts")
    .select("id,total_questions,status")
    .eq("id", attemptId)
    .eq("profile_id", ctx.profileId)
    .maybeSingle();

  if (attempt.error || !attempt.data) return { ok: false, message: "Попытка не найдена." };
  if (attempt.data.status !== "OPEN") return { ok: false, message: "Эта попытка уже завершена." };

  const tasks = await ctx.admin.from("learning_skill_practice_tasks")
    .select("id,expected_answer,parameters")
    .eq("attempt_id", attemptId)
    .order("position");

  if (tasks.error || !tasks.data || tasks.data.length !== attempt.data.total_questions) {
    return { ok: false, message: "Не удалось загрузить задания попытки." };
  }

  const answerMap = new Map(answers.map((item) => [item.taskId, item.answer.trim()]));
  if (answerMap.size !== tasks.data.length || tasks.data.some((task) => !answerMap.has(task.id))) {
    return { ok: false, message: "Ответьте на все задания." };
  }

  const normalized = tasks.data.map((task) => {
    const raw = answerMap.get(task.id) ?? "";
    const submitted = normalizeNumericAnswer(raw);
    if (!submitted) return null;
    const params = task.parameters && typeof task.parameters === "object"
      ? task.parameters as Record<string, unknown>
      : {};
    return {
      taskId: task.id,
      submitted,
      expected: task.expected_answer,
      expectedDisplay: typeof params.answer_display === "string" ? params.answer_display : task.expected_answer,
      correct: submitted === task.expected_answer,
    };
  });

  if (normalized.some((item) => item === null)) {
    return { ok: false, message: "Введите число, десятичную дробь или обычную дробь." };
  }

  const checked = normalized as NonNullable<(typeof normalized)[number]>[];
  const now = new Date().toISOString();
  const updates = await Promise.all(checked.map((item) =>
    ctx.admin.from("learning_skill_practice_tasks").update({
      submitted_answer: item.submitted,
      is_correct: item.correct,
      answered_at: now,
    }).eq("id", item.taskId).eq("attempt_id", attemptId).is("answered_at", null).select("id").maybeSingle()
  ));

  if (updates.some((result) => result.error || !result.data)) {
    return { ok: false, message: "Не удалось сохранить все ответы. Создайте новую попытку." };
  }

  const score = checked.filter((item) => item.correct).length;
  const completed = await ctx.admin.from("learning_skill_practice_attempts").update({
    status: "COMPLETED",
    correct_answers: score,
    completed_at: now,
  }).eq("id", attemptId).eq("profile_id", ctx.profileId).eq("status", "OPEN").select("id").maybeSingle();

  if (completed.error || !completed.data) return { ok: false, message: "Не удалось завершить попытку." };

  return {
    ok: true,
    message: score === checked.length ? "10/10 — навык освоен." : `${score}/${checked.length} — пока не освоен.`,
    score,
    total: checked.length,
    mastered: score === checked.length,
    results: checked.map((item) => ({
      taskId: item.taskId,
      correct: item.correct,
      expectedAnswer: item.expectedDisplay,
    })),
  };
}
