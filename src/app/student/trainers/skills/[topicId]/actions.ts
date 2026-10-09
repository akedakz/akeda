"use server";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { generateSkillTasks } from "@/lib/programs/skill-generators.server";
import { answerMeta, normalizeStrictSkillAnswer, type SkillAnswerMeta } from "@/lib/programs/skill-answer-policy";
import { normalizeNumericAnswer } from "@/lib/programs/section1-skill-generators";
import { loadStudentSkillAccess } from "@/lib/programs/student-skill-practice";
import { createAdminClient } from "@/lib/supabase/admin";

type StartResult = {
  ok: boolean;
  message: string;
  attemptId?: string;
  tasks?: { id: string; position: number; prompt: string; difficulty: "BASIC" | "CORE" | "CHALLENGE"; answerKind: SkillAnswerMeta["answerKind"]; answerHint: string }[];
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
    message: `${generated.length} задач готовы.`,
    attemptId: attempt.data.id,
    tasks: (inserted.data ?? []).map((task) => ({
      id: task.id,
      position: task.position,
      prompt: task.prompt,
      difficulty: task.difficulty as "BASIC" | "CORE" | "CHALLENGE",
      ...answerMeta(generated[task.position - 1].parameters, generated[task.position - 1].expectedAnswer),
    })),
  };
}

export async function submitStudentSkillAttempt(attemptId: string, answers: { taskId: string; answer: string }[]): Promise<SubmitResult> {
  const profile = await student();
  if (!profile) return { ok: false, message: "Недостаточно прав." };
  if (!uuid.test(attemptId) || !Array.isArray(answers)) return { ok: false, message: "Некорректная попытка." };

  if (answers.length > 50 || answers.some(item => !item || !uuid.test(item.taskId) || typeof item.answer !== "string" || item.answer.length > 100)) {
    return { ok: false, message: "Некорректный ответ." };
  }
  const admin = createAdminClient();
  const attempt = await admin.from("learning_skill_practice_attempts").select("id,total_questions,status")
    .eq("id", attemptId).eq("profile_id", profile.id).maybeSingle();
  if (attempt.error || !attempt.data) return { ok: false, message: "Попытка не найдена." };
  if (attempt.data.status !== "OPEN") return { ok: false, message: "Эта попытка уже завершена." };
  const tasks = await admin.from("learning_skill_practice_tasks").select("id,parameters").eq("attempt_id", attemptId);
  if (tasks.error || !tasks.data || tasks.data.length !== attempt.data.total_questions) return { ok: false, message: "Не удалось загрузить задания." };
  const supplied = new Map(answers.map(item => [item.taskId, item.answer]));
  if (answers.length !== tasks.data.length || supplied.size !== tasks.data.length || tasks.data.some(task => !supplied.has(task.id))) {
    return { ok: false, message: "Ответьте на все задания." };
  }
  const answerObject: Record<string, string | { value: string; raw: string }> = {};
  for (const task of tasks.data) {
    const raw = supplied.get(task.id)!;
    const params = task.parameters as Record<string, unknown>;
    const strict = params.answer_policy_version === 2;
    const value = strict ? normalizeStrictSkillAnswer(raw, params) : normalizeNumericAnswer(raw);
    if (!value) return { ok: false, message: "Заполните ответы в указанном формате." };
    answerObject[task.id] = strict ? { value, raw: raw.trim() } : value;
  }

  const result = await admin.rpc(tasks.data.every(task => (task.parameters as Record<string, unknown>).answer_policy_version === 2) ? "submit_nis_new_skill_attempt_atomic" : "submit_learning_skill_attempt_atomic", {
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
