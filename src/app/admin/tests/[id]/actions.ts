"use server";

import { revalidatePath } from "next/cache";
import { buildTestSnapshot } from "@/lib/tests/build-test-snapshot";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateSafeRasterImage } from "@/lib/files/image-signature";
import type { EditorOption, EditorQuestion, EditorTest, MultiPartPart, NumericMode, QuestionType } from "./types";

const questionTypes: QuestionType[] = ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "NUMERIC", "MATCHING", "MULTI_PART"];
const numericModes: NumericMode[] = ["EXACT", "TOLERANCE", "RANGE"];
const maxImageSize = 10 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DeleteTestResult = { ok: false; message: string };
type DeleteTestRpcResult = { status: "deleted" | "not_found"; image_paths?: string[] };

function safeError(context: string, error: { code?: string; message: string; details?: string; hint?: string }) {
  console.error(context, { code: error.code, message: error.message, details: error.details, hint: error.hint });
}

async function requireAdmin() {
  const current = await getCurrentProfile();
  if (!current || current.profile?.role !== "ADMIN") return null;
  return { admin: createAdminClient(), profileId: current.profile.id };
}

export async function deleteTest(testId: string, confirmation: string): Promise<DeleteTestResult> {
  const context = await requireAdmin();
  if (!context) return { ok: false, message: "Недостаточно прав." };
  const { admin, profileId } = context;
  if (!uuid.test(testId) || confirmation !== "DELETE") {
    return { ok: false, message: "Некорректные данные удаления." };
  }

  const { data: sourceTest, error: sourceError } = await admin.from("tests").select("folder_id").eq("id", testId).eq("created_by", profileId).eq("is_assignment_copy", false).maybeSingle();
  if (sourceError) safeError("Не удалось проверить тест перед удалением:", sourceError);
  if (sourceError || !sourceTest) return { ok: false, message: "Тест не найден." };
  let returnFolderId: string | null = sourceTest.folder_id;
  if (returnFolderId) {
    const { data: folder, error: folderError } = await admin.from("test_folders").select("id").eq("id", returnFolderId).eq("created_by", profileId).maybeSingle();
    if (folderError) safeError("Не удалось проверить папку теста перед удалением:", folderError);
    if (folderError || !folder) returnFolderId = null;
  }

  const { data, error } = await admin.rpc("delete_unassigned_test_atomic", { p_test_id: testId, p_created_by: profileId });
  if (error) {
    safeError("Атомарное удаление теста завершилось ошибкой:", error);
    return { ok: false, message: "Не удалось удалить тест. Попробуйте ещё раз." };
  }

  const result = data as DeleteTestRpcResult | null;
  if (!result || result.status === "not_found") return { ok: false, message: "Тест не найден." };
  if (result.status !== "deleted") return { ok: false, message: "Не удалось удалить тест. Попробуйте ещё раз." };

  const expectedPrefix = `tests/${testId}/questions/`;
  const imagePaths = [...new Set(result.image_paths ?? [])].filter((path) =>
    typeof path === "string" && path.startsWith(expectedPrefix) && !path.includes("..")
  );
  if (imagePaths.length) {
    const { error: storageError } = await admin.storage.from("test-images").remove(imagePaths);
    if (storageError) safeError("Тест удалён, но очистка его изображений завершилась ошибкой:", storageError);
  }

  const destination = returnFolderId ? `/admin/tests/folders/${returnFolderId}` : "/admin/tests";
  revalidatePath(destination);
  redirect(destination);
}

function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }

function validatePart(part: MultiPartPart, questionNumber: number, partNumber: number) {
  const prefix = `Вопрос ${questionNumber}, подпункт ${partNumber}`;
  if (!part.key || !part.prompt.trim() || !["NUMERIC", "SINGLE_CHOICE", "MULTIPLE_CHOICE"].includes(part.type) || !finite(part.points) || part.points <= 0) return `${prefix}: проверьте условие, тип и баллы.`;
  if (part.type === "NUMERIC") {
    if (!part.numericMode || !numericModes.includes(part.numericMode)) return `${prefix}: выберите режим числового ответа.`;
    if ((part.numericMode === "EXACT" || part.numericMode === "TOLERANCE") && !finite(part.numericAnswer)) return `${prefix}: укажите правильное число.`;
    if (part.numericMode === "TOLERANCE" && (!finite(part.numericTolerance) || part.numericTolerance < 0)) return `${prefix}: проверьте погрешность.`;
    if (part.numericMode === "RANGE" && (!finite(part.numericMin) || !finite(part.numericMax) || part.numericMin > part.numericMax)) return `${prefix}: проверьте диапазон.`;
  } else {
    const options = part.options.filter((option) => option.text.trim());
    const correct = options.filter((option) => option.isCorrect).length;
    if (options.length < 2 || (part.type === "SINGLE_CHOICE" ? correct !== 1 : correct < 1)) return `${prefix}: проверьте варианты и правильные ответы.`;
  }
  return null;
}

function validateQuestion(question: EditorQuestion, index: number) {
  const errors: string[] = [];
  if (!questionTypes.includes(question.type)) errors.push("Неизвестный тип вопроса.");
  if (!question.prompt.trim() && !question.imagePath) errors.push(`Вопрос ${index + 1}: добавьте текст или изображение.`);
  if (!finite(question.points) || question.points <= 0) errors.push(`Вопрос ${index + 1}: баллы должны быть положительным числом.`);

  if (question.type === "SINGLE_CHOICE" || question.type === "MULTIPLE_CHOICE") {
    const options = question.options.filter((option) => option.text.trim());
    if (options.length < 2) errors.push(`Вопрос ${index + 1}: нужны минимум два заполненных варианта.`);
    const correct = options.filter((option) => option.isCorrect).length;
    if (question.type === "SINGLE_CHOICE" && correct !== 1) errors.push(`Вопрос ${index + 1}: выберите ровно один правильный ответ.`);
    if (question.type === "MULTIPLE_CHOICE" && correct < 1) errors.push(`Вопрос ${index + 1}: выберите хотя бы один правильный ответ.`);
  }

  if (question.type === "NUMERIC") {
    if (!question.numericMode || !numericModes.includes(question.numericMode)) errors.push(`Вопрос ${index + 1}: выберите режим числового ответа.`);
    if ((question.numericMode === "EXACT" || question.numericMode === "TOLERANCE") && !finite(question.numericAnswer)) errors.push(`Вопрос ${index + 1}: укажите правильное число.`);
    if (question.numericMode === "TOLERANCE" && (!finite(question.numericTolerance) || question.numericTolerance < 0)) errors.push(`Вопрос ${index + 1}: погрешность должна быть неотрицательной.`);
    if (question.numericMode === "RANGE" && (!finite(question.numericMin) || !finite(question.numericMax) || question.numericMin > question.numericMax)) errors.push(`Вопрос ${index + 1}: проверьте границы диапазона.`);
  }
  if (question.type === "MATCHING") {
    const config = question.typeConfig && "matching" in question.typeConfig ? question.typeConfig.matching : null;
    if (!config || config.leftItems.length < 2 || config.options.length < 2) errors.push(`Вопрос ${index + 1}: нужны минимум две пары и два варианта.`);
    else {
      const leftKeys = new Set(config.leftItems.map((item) => item.key));
      const optionKeys = new Set(config.options.map((option) => option.key));
      const correctKeys = config.leftItems.map((item) => item.correctOptionKey);
      if (leftKeys.size !== config.leftItems.length || optionKeys.size !== config.options.length || config.leftItems.some((item) => !item.key || !item.text.trim() || !item.correctOptionKey || !optionKeys.has(item.correctOptionKey)) || config.options.some((option) => !option.key || !option.text.trim())) errors.push(`Вопрос ${index + 1}: проверьте уникальные ключи, тексты и соответствия.`);
      if (!config.allowOptionReuse && new Set(correctKeys).size !== correctKeys.length) errors.push(`Вопрос ${index + 1}: один вариант назначен нескольким элементам.`);
    }
  }
  if (question.type === "MULTI_PART") {
    const config = question.typeConfig && "multiPart" in question.typeConfig ? question.typeConfig.multiPart : null;
    if (!config || config.parts.length < 1 || new Set(config.parts.map((part) => part.key)).size !== config.parts.length) errors.push(`Вопрос ${index + 1}: добавьте корректные подпункты с уникальными ключами.`);
    else for (let partIndex = 0; partIndex < config.parts.length; partIndex += 1) { const error = validatePart(config.parts[partIndex], index + 1, partIndex + 1); if (error) errors.push(error); }
  }
  return errors;
}

function normalizedOption(option: EditorOption, position: number) {
  return { id: option.id, clientId: option.clientId, text: option.text.trim(), isCorrect: option.isCorrect, position };
}

function normalizedQuestion(question: EditorQuestion, position: number) {
  const isChoice = question.type === "SINGLE_CHOICE" || question.type === "MULTIPLE_CHOICE";
  return {
    id: question.id,
    clientId: question.clientId,
    type: question.type,
    prompt: question.prompt.trim(),
    imagePath: question.imagePath,
    points: question.type === "MATCHING" && question.typeConfig && "matching" in question.typeConfig ? question.typeConfig.matching.leftItems.length : question.type === "MULTI_PART" && question.typeConfig && "multiPart" in question.typeConfig ? question.typeConfig.multiPart.parts.reduce((sum, part) => sum + part.points, 0) : question.points,
    isRequired: question.isRequired,
    position,
    numericMode: question.type === "NUMERIC" ? question.numericMode : null,
    numericAnswer: question.type === "NUMERIC" && question.numericMode !== "RANGE" ? question.numericAnswer : null,
    numericTolerance: question.type === "NUMERIC" && question.numericMode === "TOLERANCE" ? question.numericTolerance : null,
    numericMin: question.type === "NUMERIC" && question.numericMode === "RANGE" ? question.numericMin : null,
    numericMax: question.type === "NUMERIC" && question.numericMode === "RANGE" ? question.numericMax : null,
    options: isChoice ? question.options.filter((option) => option.text.trim()).map(normalizedOption) : [],
    typeConfig: question.type === "MATCHING" && question.typeConfig && "matching" in question.typeConfig ? { matching: { ...question.typeConfig.matching, leftItems: question.typeConfig.matching.leftItems.map((item, index) => ({ ...item, label: String.fromCharCode(65 + index), text: item.text.trim(), position: index })), options: question.typeConfig.matching.options.map((option, index) => ({ ...option, label: String(index + 1), text: option.text.trim(), position: index })) } } : question.type === "MULTI_PART" && question.typeConfig && "multiPart" in question.typeConfig ? { multiPart: { parts: question.typeConfig.multiPart.parts.map((part, index) => ({ ...part, label: String.fromCharCode(97 + index), prompt: part.prompt.trim(), position: index, options: part.type === "NUMERIC" ? [] : part.options.filter((option) => option.text.trim()).map(normalizedOption) })) } } : null,
  };
}

export async function saveTestEditor(testId: string, editor: EditorTest): Promise<{ ok: true; test: EditorTest } | { ok: false; message: string }> {
  const context = await requireAdmin();
  if (!context) return { ok: false, message: "Недостаточно прав для сохранения теста." };
  const { admin } = context;
  if (!editor || typeof editor !== "object" || editor.id !== testId || typeof editor.title !== "string" || typeof editor.description !== "string" || !Array.isArray(editor.questions)) return { ok: false, message: "Некорректные данные редактора." };
  if (!editor.title.trim()) return { ok: false, message: "Введите название теста." };
  const malformedQuestion = editor.questions.some((question) => !question || typeof question !== "object" || typeof question.clientId !== "string" || typeof question.prompt !== "string" || !Array.isArray(question.options) || question.options.some((option) => !option || typeof option.clientId !== "string" || typeof option.text !== "string" || typeof option.isCorrect !== "boolean"));
  if (malformedQuestion) return { ok: false, message: "Некорректные данные вопроса." };

  const validationErrors = editor.questions.flatMap((question, index) => {
    const errors = validateQuestion(question, index);
    if (question.imagePath && (typeof question.imagePath !== "string" || !question.imagePath.startsWith(`tests/${testId}/questions/`))) errors.push(`Вопрос ${index + 1}: некорректный путь изображения.`);
    return errors;
  });
  if (validationErrors.length) return { ok: false, message: validationErrors[0] };

  const { data: test, error: testError } = await admin.from("tests").select("id").eq("id", testId).eq("created_by", context.profileId).eq("is_assignment_copy", false).maybeSingle();
  if (testError) safeError("Не удалось проверить тест перед сохранением:", testError);
  if (testError || !test) return { ok: false, message: "Тест не найден или недоступен." };

  const { data: existingImages, error: existingImagesError } = await admin.from("test_questions").select("image_path").eq("test_id", testId).not("image_path", "is", null);
  if (existingImagesError) {
    safeError("Не удалось проверить текущие изображения теста перед сохранением:", existingImagesError);
    return { ok: false, message: "Не удалось проверить изображения теста перед сохранением." };
  }

  const questions = editor.questions.map(normalizedQuestion);
  const { data, error } = await admin.rpc("save_test_editor", { p_test_id: testId, p_title: editor.title.trim(), p_description: editor.description.trim() || null, p_questions: questions });
  if (error) {
    safeError("Транзакционное сохранение редактора завершилось ошибкой:", error);
    return { ok: false, message: "Не удалось сохранить тест. Проверьте, что SQL-функция установлена." };
  }

  const retainedPaths = new Set(questions.map((question) => question.imagePath).filter((path): path is string => Boolean(path)));
  const removedPaths = [...new Set((existingImages ?? []).map((row) => row.image_path).filter((path): path is string => Boolean(path) && !retainedPaths.has(path)))];
  if (removedPaths.length) {
    const { data: candidates, error: candidatesError } = await admin.rpc("test_image_cleanup_candidates", { p_test_id: testId, p_paths: removedPaths, p_created_by: context.profileId });
    if (candidatesError) safeError("Тест сохранён, но не удалось подготовить cleanup заменённых изображений:", candidatesError);
    else {
      const safePaths = [...new Set((candidates ?? []) as string[])].filter((path) => path.startsWith(`tests/${testId}/questions/`) && !path.includes(".."));
      if (safePaths.length) {
        const { error: storageError } = await admin.storage.from("test-images").remove(safePaths);
        if (storageError) safeError("Тест сохранён, но cleanup заменённых изображений завершился ошибкой:", storageError);
      }
    }
  }

  const { error: statusError } = await admin.from("tests").update({ status: "PUBLISHED" }).eq("id", testId).eq("created_by", context.profileId).eq("status", "DRAFT");
  if (statusError) {
    safeError("Тест сохранён, но не удалось опубликовать legacy-черновик:", statusError);
    return { ok: false, message: "Тест сохранён, но не удалось перевести его в опубликованное состояние." };
  }

  revalidatePath(`/admin/tests/${testId}`);
  return { ok: true, test: { ...(data as EditorTest), status: "PUBLISHED" } };
}

export async function publishTest(testId: string): Promise<{ ok: boolean; message: string }> {
  const current = await getCurrentProfile();
  if (!current || current.profile?.role !== "ADMIN" || !uuid.test(testId)) return { ok: false, message: "Недостаточно прав для публикации теста." };
  const admin = createAdminClient();
  const built = await buildTestSnapshot(admin, testId, current.profile.id, false);
  if (!built.ok) return { ok: false, message: built.reason === "empty" ? "Добавьте хотя бы один валидный вопрос." : "Тест не найден или не прошёл проверку." };
  const { data, error } = await admin.from("tests").update({ status: "PUBLISHED", updated_at: new Date().toISOString() }).eq("id", testId).eq("created_by", current.profile.id).eq("status", "DRAFT").select("id").maybeSingle();
  if (error || !data) return { ok: false, message: "Опубликовать можно только собственный черновик." };
  revalidatePath(`/admin/tests/${testId}`);
  revalidatePath("/admin/tests");
  return { ok: true, message: "Тест опубликован." };
}

export async function uploadQuestionImage(testId: string, questionKey: string, formData: FormData): Promise<{ ok: true; imagePath: string; imageUrl: string } | { ok: false; message: string }> {
  const context = await requireAdmin();
  if (!context) return { ok: false, message: "Недостаточно прав для загрузки изображения." };
  const { admin } = context;
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, message: "Выберите PNG, JPEG, WEBP или GIF размером до 10 МБ." };
  const detected = await validateSafeRasterImage(file, maxImageSize);
  if (!detected) return { ok: false, message: "Файл должен быть настоящим PNG, JPEG, WEBP или GIF размером до 10 МБ." };

  const { data: test, error: testError } = await admin.from("tests").select("id").eq("id", testId).eq("created_by", context.profileId).eq("is_assignment_copy", false).maybeSingle();
  if (testError) safeError("Не удалось проверить тест перед загрузкой изображения:", testError);
  if (testError || !test) return { ok: false, message: "Тест не найден или недоступен." };
  const safeQuestionKey = questionKey.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  if (!safeQuestionKey) return { ok: false, message: "Некорректный идентификатор вопроса." };
  const imagePath = `tests/${testId}/questions/${safeQuestionKey}/${crypto.randomUUID()}.${detected.extension}`;
  const { error } = await admin.storage.from("test-images").upload(imagePath, file, { contentType: detected.mimeType, upsert: false });
  if (error) {
    safeError("Не удалось загрузить изображение вопроса:", error);
    return { ok: false, message: "Не удалось загрузить изображение." };
  }
  const { data: signed, error: signedError } = await admin.storage.from("test-images").createSignedUrl(imagePath, 60 * 60);
  if (signedError) {
    safeError("Не удалось создать ссылку изображения:", signedError);
    return { ok: false, message: "Изображение загружено, но превью недоступно." };
  }
  return { ok: true, imagePath, imageUrl: signed.signedUrl };
}
