"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildTestSnapshot } from "@/lib/tests/build-test-snapshot";
import type { AssignmentActionState } from "@/components/students/test-assignment-types";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function logError(context: string, error: { code?: string; message: string; details?: string; hint?: string }) {
  console.error(context, { code: error.code, message: error.message, details: error.details, hint: error.hint });
}

async function getAdminContext() {
  const current = await getCurrentProfile();
  if (!current || current.profile?.role !== "ADMIN") return null;
  return { profileId: current.profile.id, admin: createAdminClient() };
}

export async function createTestAssignment(studentId: string, _state: AssignmentActionState, formData: FormData): Promise<AssignmentActionState> {
  const context = await getAdminContext();
  if (!context) return { status: "error", message: "Недостаточно прав для назначения теста." };
  const testId = String(formData.get("testId") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const deadlineRaw = String(formData.get("deadlineAt") ?? "").trim();
  const showAnswers = formData.get("showCorrectAnswersAfterClose") === "on";
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  if (!uuidPattern.test(studentId)) return { status: "error", message: "Некорректный идентификатор ученика." };
  if (!uuidPattern.test(testId)) return { status: "error", message: "Некорректный идентификатор теста." };
  if (!uuidPattern.test(idempotencyKey)) return { status: "error", message: "Некорректный ключ операции." };
  if (!title) return { status: "error", message: "Введите название теста." };

  let deadlineAt: string | null = null;
  if (deadlineRaw) {
    const deadline = new Date(deadlineRaw);
    if (Number.isNaN(deadline.getTime())) return { status: "error", message: "Некорректный дедлайн." };
    deadlineAt = deadline.toISOString();
  }

  const { data: student, error: studentError } = await context.admin.from("profiles").select("id").eq("id", studentId).eq("role", "STUDENT").maybeSingle();
  if (studentError) {
    logError("Не удалось проверить ученика перед назначением:", studentError);
    return { status: "error", message: "Не удалось проверить ученика." };
  }
  if (!student) return { status: "error", message: "Ученик не найден." };

  const built = await buildTestSnapshot(context.admin, testId, context.profileId);
  if (!built.ok) {
    if (built.reason === "not_found") return { status: "error", message: "Тест не найден." };
    if (built.reason === "empty") return { status: "error", message: "Тест не содержит вопросов." };
    return { status: "error", message: "Не удалось создать snapshot теста." };
  }

  const { data, error } = await context.admin.rpc("create_single_attempt_test_assignment_atomic", {
    p_student_id: studentId,
    p_source_test_id: built.test.id,
    p_title: title,
    p_snapshot: built.snapshot,
    p_deadline_at: deadlineAt,
    p_show_correct_answers_after_close: showAnswers,
    p_assigned_by: context.profileId,
    p_idempotency_key: idempotencyKey,
  });
  if (error) {
    logError("Не удалось сохранить назначение теста:", error);
    return { status: "error", message: "Не удалось назначить тест. Проверьте, что SQL-миграция установлена." };
  }
  const result = data as { status?: "created" | "already_created" | "active_exists" | "forbidden" | "invalid" } | null;
  if (result?.status === "active_exists") return { status: "error", message: "Этот тест уже назначен ученику и ещё не завершён." };
  if (result?.status === "forbidden") return { status: "error", message: "Ученик или исходный тест недоступен." };
  if (result?.status !== "created" && result?.status !== "already_created") return { status: "error", message: "Не удалось назначить тест." };

  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath("/student");
  revalidatePath("/student/tests");
  revalidatePath("/student/progress");
  return { status: "success", message: "Тест назначен" };
}

type CompositeAssignmentRpcResult = { status?: "created" | "student_not_found" | "invalid_sources" | "invalid_limit"; assignment_id?: string; test_id?: string };

export async function createCompositeTestAssignment(studentId: string, _state: AssignmentActionState, formData: FormData): Promise<AssignmentActionState> {
  const context = await getAdminContext();
  if (!context) return { status: "error", message: "Недостаточно прав для составления теста." };
  if (!uuidPattern.test(studentId)) return { status: "error", message: "Некорректный идентификатор ученика." };

  let sourceTestIds: unknown;
  try { sourceTestIds = JSON.parse(String(formData.get("sourceTestIds") ?? "[]")); }
  catch { return { status: "error", message: "Некорректный список исходных тестов." }; }
  if (!Array.isArray(sourceTestIds) || sourceTestIds.length < 1 || sourceTestIds.length > 100 || sourceTestIds.some((id) => typeof id !== "string" || !uuidPattern.test(id)) || new Set(sourceTestIds).size !== sourceTestIds.length) {
    return { status: "error", message: "Выберите один или несколько уникальных исходных тестов." };
  }

  const title = String(formData.get("title") ?? "").trim();
  const questionCount = Number(formData.get("questionCount"));
  const samplingMode = String(formData.get("samplingMode") ?? "");
  const shuffle = formData.get("shuffleQuestions") === "on";
  const deadlineRaw = String(formData.get("deadlineAt") ?? "").trim();
  const showAnswers = formData.get("showCorrectAnswersAfterClose") === "on";
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
  if (!uuidPattern.test(idempotencyKey)) return { status: "error", message: "Некорректный ключ операции." };
  if (!title || title.length > 240) return { status: "error", message: "Введите название теста длиной до 240 символов." };
  if (!Number.isInteger(questionCount) || questionCount < 1) return { status: "error", message: "Количество вопросов должно быть положительным целым числом." };
  if (samplingMode !== "POOL" && samplingMode !== "BALANCED") return { status: "error", message: "Выберите способ выборки вопросов." };

  let deadlineAt: string | null = null;
  if (deadlineRaw) {
    const deadline = new Date(deadlineRaw);
    if (Number.isNaN(deadline.getTime())) return { status: "error", message: "Некорректный дедлайн." };
    deadlineAt = deadline.toISOString();
  }

  const { data: student, error: studentError } = await context.admin.from("profiles").select("id").eq("id", studentId).eq("role", "STUDENT").maybeSingle();
  if (studentError || !student) {
    if (studentError) logError("Не удалось проверить ученика перед составлением теста:", studentError);
    return { status: "error", message: studentError ? "Не удалось проверить ученика." : "Ученик не найден." };
  }

  const { data, error } = await context.admin.rpc("create_composite_test_assignment_atomic", {
    p_student_id: studentId,
    p_source_test_ids: sourceTestIds,
    p_title: title,
    p_question_count: questionCount,
    p_sampling_mode: samplingMode,
    p_shuffle_questions: shuffle,
    p_deadline_at: deadlineAt,
    p_show_correct_answers_after_close: showAnswers,
    p_assigned_by: context.profileId,
    p_idempotency_key: idempotencyKey,
  });
  if (error) {
    logError("Атомарное составление теста завершилось ошибкой:", error);
    return { status: "error", message: "Не удалось составить тест. Проверьте, что SQL-миграция установлена, и повторите попытку." };
  }
  const result = data as CompositeAssignmentRpcResult | null;
  if (result?.status === "invalid_sources") return { status: "error", message: "Исходные тесты недоступны, не опубликованы, пусты или являются скрытыми копиями." };
  if (result?.status === "invalid_limit") return { status: "error", message: "Запрошено больше вопросов, чем доступно в выбранных тестах." };
  if (result?.status === "student_not_found") return { status: "error", message: "Ученик не найден." };
  if (result?.status !== "created") return { status: "error", message: "Не удалось составить тест." };

  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath("/student");
  revalidatePath("/student/tests");
  revalidatePath("/student/progress");
  return { status: "success", message: "Индивидуальный тест составлен и назначен." };
}

export async function deleteTestAssignment(studentId: string, assignmentId: string, previousState: AssignmentActionState, formData: FormData): Promise<AssignmentActionState> {
  void previousState;
  void formData;
  const context = await getAdminContext();
  if (!context) return { status: "error", message: "Недостаточно прав для удаления назначения." };
  if (!uuidPattern.test(studentId) || !uuidPattern.test(assignmentId)) return { status: "error", message: "Некорректные данные назначения." };

  const { data, error: findError } = await context.admin.from("test_assignments").select("id").eq("id", assignmentId).eq("student_id", studentId).maybeSingle();
  if (findError) {
    logError("Не удалось проверить назначение перед удалением:", findError);
    return { status: "error", message: "Не удалось проверить назначение." };
  }
  if (!data) return { status: "error", message: "Назначение не найдено." };

  const { data: deleted, error } = await context.admin.rpc("delete_test_assignment_safe", { p_assignment_id: assignmentId, p_student_id: studentId, p_assigned_by: context.profileId });
  if (error) {
    logError("Не удалось удалить назначение:", error);
    return { status: "error", message: "Не удалось удалить назначение." };
  }
  const result = deleted as { status?: string; image_paths?: string[] } | null;
  if (result?.status === "not_found") return { status: "error", message: "Назначение не найдено." };
  if (result?.status !== "deleted") return { status: "error", message: "Не удалось удалить назначение." };
  const imagePaths = [...new Set(result.image_paths ?? [])].filter((path) => typeof path === "string" && path.startsWith("tests/") && !path.includes(".."));
  if (imagePaths.length) {
    const { error: storageError } = await context.admin.storage.from("test-images").remove(imagePaths);
    if (storageError) logError("Назначение удалено, но очистка неиспользуемых изображений завершилась ошибкой:", storageError);
  }
  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath("/admin");
  revalidatePath("/student");
  revalidatePath("/student/tests");
  revalidatePath("/student/progress");
  return { status: "success", message: "Назначение удалено." };
}
