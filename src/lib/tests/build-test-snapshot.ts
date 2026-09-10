import "server-only";

import type { NumericMode, QuestionType, QuestionTypeConfig } from "@/app/admin/tests/[id]/types";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { TestSnapshot } from "./test-snapshot-types";

type AdminClient = ReturnType<typeof createAdminClient>;
type TestRow = { id: string; title: string; description: string | null; status: string };
type QuestionRow = { id: string; logical_question_id: string; type: QuestionType; prompt: string; image_path: string | null; points: number; is_required: boolean; position: number; numeric_mode: NumericMode | null; numeric_answer: number | null; numeric_tolerance: number | null; numeric_min: number | null; numeric_max: number | null; type_config: QuestionTypeConfig | null };
type OptionRow = { id: string; question_id: string; text: string; is_correct: boolean; position: number };

export type SnapshotBuildResult =
  | { ok: true; test: TestRow; snapshot: TestSnapshot }
  | { ok: false; reason: "not_found" | "empty" | "query_error" };

function logError(context: string, error: { code?: string; message: string; details?: string; hint?: string }) {
  console.error(context, { code: error.code, message: error.message, details: error.details, hint: error.hint });
}

export async function buildTestSnapshot(admin: AdminClient, testId: string, createdBy: string, requirePublished = true): Promise<SnapshotBuildResult> {
  const { data: testData, error: testError } = await admin.from("tests").select("id, title, description, status").eq("id", testId).eq("created_by", createdBy).maybeSingle();
  if (testError) {
    logError("Не удалось загрузить тест для snapshot:", testError);
    return { ok: false, reason: "query_error" };
  }
  if (!testData || requirePublished && testData.status !== "PUBLISHED") return { ok: false, reason: "not_found" };

  const { data: questionData, error: questionError } = await admin
    .from("test_questions")
    .select("id, logical_question_id, type, prompt, image_path, points, is_required, position, numeric_mode, numeric_answer, numeric_tolerance, numeric_min, numeric_max, type_config")
    .eq("test_id", testId)
    .order("position", { ascending: true });
  if (questionError) {
    logError("Не удалось загрузить вопросы для snapshot:", questionError);
    return { ok: false, reason: "query_error" };
  }

  const questions = (questionData ?? []) as QuestionRow[];
  if (!questions.length) return { ok: false, reason: "empty" };
  const { data: optionData, error: optionError } = await admin
    .from("test_question_options")
    .select("id, question_id, text, is_correct, position")
    .in("question_id", questions.map((question) => question.id))
    .order("position", { ascending: true });
  if (optionError) {
    logError("Не удалось загрузить варианты для snapshot:", optionError);
    return { ok: false, reason: "query_error" };
  }

  const optionsByQuestion = new Map<string, OptionRow[]>();
  for (const option of (optionData ?? []) as OptionRow[]) {
    const options = optionsByQuestion.get(option.question_id) ?? [];
    options.push(option);
    optionsByQuestion.set(option.question_id, options);
  }

  const test = testData as TestRow;
  return {
    ok: true,
    test,
    snapshot: {
      version: 2,
      sourceTestId: test.id,
      createdBy,
      title: test.title,
      description: test.description ?? "",
      questions: questions.map((question) => {
        const common = { key: question.id, logicalQuestionId: question.logical_question_id, prompt: question.prompt, imagePath: question.image_path, points: Number(question.points), required: question.is_required, position: question.position };
        if (question.type === "MATCHING" && question.type_config && "matching" in question.type_config) return { ...common, type: question.type, matching: question.type_config.matching };
        if (question.type === "MULTI_PART" && question.type_config && "multiPart" in question.type_config) return { ...common, type: question.type, multiPart: { parts: question.type_config.multiPart.parts.map((part) => ({ ...part, numeric: { mode: part.numericMode, exactValue: part.numericAnswer, tolerance: part.numericTolerance, rangeMin: part.numericMin, rangeMax: part.numericMax }, options: part.options.map((option) => ({ key: option.id ?? option.clientId, text: option.text, isCorrect: option.isCorrect, position: option.position })) })) } };
        return { ...common, type: question.type as "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "NUMERIC", numeric: {
          mode: question.numeric_mode,
          exactValue: question.numeric_answer === null ? null : Number(question.numeric_answer),
          tolerance: question.numeric_tolerance === null ? null : Number(question.numeric_tolerance),
          rangeMin: question.numeric_min === null ? null : Number(question.numeric_min),
          rangeMax: question.numeric_max === null ? null : Number(question.numeric_max),
        }, options: (optionsByQuestion.get(question.id) ?? []).map((option) => ({ key: option.id, text: option.text, isCorrect: option.is_correct, position: option.position })) };
      }) as TestSnapshot["questions"],
    },
  };
}
