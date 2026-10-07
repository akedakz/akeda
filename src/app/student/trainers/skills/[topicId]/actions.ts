"use server";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { generateSkillTasks } from "@/lib/programs/skill-generators.server";
import { normalizeNumericAnswer } from "@/lib/programs/section1-skill-generators";
import { loadStudentSkillAccess } from "@/lib/programs/student-skill-practice";
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

async function student() {
  const current = await getCurrentProfile();
  return current?.profile?.role === "STUDENT" ? current.profile : null;
}

export async function startStudentSkillAttempt(topicId: string): Promise<StartResult> {
  const profile = await student();
  if (!profile) return { ok: false, message: "Недостаточно прав." };
  if (!uuid.test(topicId)) return { ok: false, message: "Некорректный навык." };

  const access = await loadStudentSkillAccess(profile.id, topicId);
  if (!access) return { ok: false, message: "Этот навык вам не назначен." };
  let generated;
  try {
    generated = generateSkillTasks(access.generator.generator_key, access.generator.config);
  } catch (error) {
    console.error("STUDENT_SKILL_GENERATOR", error);
    return { ok: false, message: "Не удалось сгенерировать набор задач." };
  }

  const admin = createAdminClient();
  const attempt = await admin.from("learning_skill_practice_attempts").insert({
    profile_id: profile.id,
    program_topic_id: topicId,
    generator_id: access.generator.id,
    total_questions: generated.length,
  }).select("id").single();

  if (attempt.error || !attempt.data) return { ok: false, message: "Не удалось создать попытку." };

  const inserted = await admin.from("learning_skill_practice_tasks").insert(generated.map((task, index) => ({
    attempt_id: attempt.data.id,
    position: index + 1,
    prompt: task.prompt,
    difficulty: task.difficulty,
    parameters: task.parameters,
    expected_answer: task.expectedAnswer,
  }))).select("id,position,prompt,difficulty").order("position");

  if (inserted.error) {
    await admin.from("learning_skill_practice_attempts").delete().eq("id", attempt.data.id);
    return { ok: false, message: "Не удалось сохранить задания попытки." };
  }

  return {
    ok: true,
    message: "10 задач готовы.",
    attemptId: attempt.data.id,
    tasks: (inserted.data ?? []).map((task) => ({
      id: task.id,
      position: task.position,
      prompt: task.prompt,
      difficulty: task.difficulty as "BASIC" | "CORE" | "CHALLENGE",
    })),
  };
}

export async function submitStudentSkillAttempt(attemptId: string, answers: { taskId: string; answer: string }[]): Promise<SubmitResult> {
  const profile = await student();
  if (!profile) return { ok: false, message: "Недостаточно прав." };
  if (!uuid.test(attemptId) || !Array.isArray(answers)) return { ok: false, message: "Некорректная попытка." };

  const answerObject: Record<string, string> = {};
  for (const item of answers) {
    if (!uuid.test(item.taskId)) return { ok: false, message: "Некорректный ответ." };
    const normalized = normalizeNumericAnswer(item.answer);
    if (!normalized) return { ok: false, message: "Введите число, десятичную дробь или обычную дробь." };
    answerObject[item.taskId] = normalized;
  }

  const admin = createAdminClient();
  const result = await admin.rpc("submit_learning_skill_attempt_atomic", {
    p_student_id: profile.id,
    p_attempt_id: attemptId,
    p_answers: answerObject,
  });

  if (result.error) {
    console.error("SUBMIT_STUDENT_SKILL", result.error);
    return { ok: false, message: "Не удалось проверить попытку." };
  }

  const data = result.data as {
    status?: string;
    score?: number;
    total?: number;
    mastered?: boolean;
    results?: { task_id: string; correct: boolean; expected_answer: string }[];
  } | null;

  if (data?.status !== "completed") {
    const messages: Record<string, string> = {
      invalid_answers: "Ответьте на все задания.",
      incomplete: "Ответьте на все задания.",
      invalid_answer: "Введите число, десятичную дробь или обычную дробь.",
      already_completed: "Эта попытка уже завершена.",
      not_assigned: "Этот навык больше не назначен.",
      attempt_not_found: "Попытка не найдена.",
    };
    return { ok: false, message: messages[data?.status ?? ""] ?? "Не удалось завершить попытку." };
  }

  const score = Number(data.score ?? 0), total = Number(data.total ?? 0), mastered = Boolean(data.mastered);
  return {
    ok: true,
    message: mastered ? `${score}/${total} — навык освоен ✓` : `${score}/${total} — пока не освоен.`,
    score,
    total,
    mastered,
    results: (data.results ?? []).map((item) => ({
      taskId: item.task_id,
      correct: item.correct,
      expectedAnswer: item.expected_answer,
    })),
  };
}
