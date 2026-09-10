import { notFound } from "next/navigation";
import { signStoragePathsBatch } from "@/lib/storage/sign-storage-paths-batch";
import { createAdminClient } from "@/lib/supabase/admin";
import TestEditor from "./test-editor";
import type { EditorOption, EditorQuestion, EditorTest, NumericMode, QuestionType, QuestionTypeConfig } from "./types";
import styles from "../tests.module.css";

type TestRow = { id: string; folder_id: string | null; title: string; description: string | null; status: "DRAFT" | "PUBLISHED" };
type QuestionRow = { id: string; type: QuestionType; prompt: string; image_path: string | null; points: number; is_required: boolean; position: number; numeric_mode: NumericMode | null; numeric_answer: number | null; numeric_tolerance: number | null; numeric_min: number | null; numeric_max: number | null; type_config: QuestionTypeConfig | null };
type OptionRow = { id: string; question_id: string; text: string; is_correct: boolean; position: number };

function logError(context: string, error: { code?: string; message: string; details?: string; hint?: string }) {
  console.error(context, { code: error.code, message: error.message, details: error.details, hint: error.hint });
}

export default async function TestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminClient();
  const { data: testData, error: testError } = await admin.from("tests").select("id, folder_id, title, description, status").eq("id", id).eq("is_assignment_copy", false).maybeSingle();
  if (testError) {
    logError("Не удалось загрузить тест:", testError);
    return <div className={styles.queryError}>Не удалось загрузить тест.{process.env.NODE_ENV === "development" && <code>{testError.code || "Supabase error"}: {testError.message}</code>}</div>;
  }
  if (!testData) notFound();
  const test = testData as TestRow;

  const { data: questionData, error: questionError } = await admin.from("test_questions").select("id, type, prompt, image_path, points, is_required, position, numeric_mode, numeric_answer, numeric_tolerance, numeric_min, numeric_max, type_config").eq("test_id", id).order("position", { ascending: true });
  if (questionError) {
    logError("Не удалось загрузить вопросы теста:", questionError);
    return <div className={styles.queryError}>Не удалось загрузить вопросы.{process.env.NODE_ENV === "development" && <code>{questionError.code || "Supabase error"}: {questionError.message}</code>}</div>;
  }
  const questionRows = (questionData ?? []) as QuestionRow[];
  const questionIds = questionRows.map((question) => question.id);
  const optionsResult = questionIds.length
    ? await admin.from("test_question_options").select("id, question_id, text, is_correct, position").in("question_id", questionIds).order("position", { ascending: true })
    : { data: [] as OptionRow[], error: null };
  if (optionsResult.error) {
    logError("Не удалось загрузить варианты ответов:", optionsResult.error);
    return <div className={styles.queryError}>Не удалось загрузить варианты ответов.{process.env.NODE_ENV === "development" && <code>{optionsResult.error.code || "Supabase error"}: {optionsResult.error.message}</code>}</div>;
  }

  const optionRows = (optionsResult.data ?? []) as OptionRow[];
  const optionsByQuestion = new Map<string, EditorOption[]>();
  for (const item of optionRows) {
    const list = optionsByQuestion.get(item.question_id) ?? [];
    list.push({ id: item.id, clientId: item.id, text: item.text, isCorrect: item.is_correct, position: item.position });
    optionsByQuestion.set(item.question_id, list);
  }
  const signedUrls = await signStoragePathsBatch(admin, "test-images", questionRows.map((question) => question.image_path), 60 * 60);

  const questions: EditorQuestion[] = questionRows.map((question) => ({ id: question.id, clientId: question.id, type: question.type, prompt: question.prompt, imagePath: question.image_path, imageUrl: question.image_path ? signedUrls.get(question.image_path) ?? null : null, points: Number(question.points), isRequired: question.is_required, position: question.position, numericMode: question.numeric_mode, numericAnswer: question.numeric_answer === null ? null : Number(question.numeric_answer), numericTolerance: question.numeric_tolerance === null ? null : Number(question.numeric_tolerance), numericMin: question.numeric_min === null ? null : Number(question.numeric_min), numericMax: question.numeric_max === null ? null : Number(question.numeric_max), options: optionsByQuestion.get(question.id) ?? [], typeConfig: question.type_config }));
  const editorTest: EditorTest = { id: test.id, folderId: test.folder_id, title: test.title, description: test.description ?? "", questions, status: test.status };
  const backHref = test.folder_id ? `/admin/tests/folders/${test.folder_id}` : "/admin/tests";

  return <TestEditor initialTest={editorTest} backHref={backHref} />;
}
