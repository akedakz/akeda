"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { importedToEditor, parseTestImport } from "@/lib/tests/test-import";
import { digestTestImport, importStoragePrefix, signImportToken, verifyImportToken, type ImportToken } from "@/lib/tests/test-import-session";
import { saveTestEditor } from "./[id]/actions";

type Result =
  | { ok: true; testId: string; importToken: string }
  | { ok: false; message: string; errors?: string[] };
type ImageRef = { filename: string; path: string };
type CleanupResult = { ok: true } | { ok: false; message: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const storageBucket = "test-images";

function logError(context: string, error: unknown) {
  console.error(context, error);
}

async function context() {
  const current = await getCurrentProfile();
  return current?.profile?.role === "ADMIN"
    ? { id: current.profile.id, admin: createAdminClient() }
    : null;
}

async function validFolder(admin: ReturnType<typeof createAdminClient>, folderId: string | null, adminId: string) {
  if (!folderId) return true;
  if (!uuid.test(folderId)) return false;
  const { data, error } = await admin.from("test_folders").select("id").eq("id", folderId).eq("created_by", adminId).maybeSingle();
  return !error && Boolean(data);
}

async function listImportPaths(admin: ReturnType<typeof createAdminClient>, prefix: string) {
  const paths: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await admin.storage.from(storageBucket).list(prefix, { limit: 100, offset });
    if (error) return { ok: false as const, error };
    const files = (data ?? []).filter((item) => item.id).map((item) => `${prefix}/${item.name}`);
    paths.push(...files);
    if ((data ?? []).length < 100) return { ok: true as const, paths };
  }
}

async function cleanupStaleImports(admin: ReturnType<typeof createAdminClient>, adminId: string) {
  const { data, error } = await admin.rpc("prepare_stale_test_import_cleanup", { p_admin_id: adminId });
  if (error) { logError("Не удалось подготовить cleanup старых импортов:", error); return; }
  for (const session of (data ?? []) as Array<{ test_id: string; storage_prefix: string }>) {
    const listed = await listImportPaths(admin, session.storage_prefix);
    if (!listed.ok) { logError("Не удалось перечислить файлы старого импорта:", listed.error); continue; }
    if (listed.paths.length) {
      const candidates = await admin.rpc("test_import_image_cleanup_candidates", { p_test_id: session.test_id, p_paths: listed.paths, p_admin_id: adminId });
      if (candidates.error) { logError("Не удалось проверить refs изображений старого импорта:", candidates.error); continue; }
      const safePaths = [...new Set((candidates.data ?? []) as string[])].filter((path) => path.startsWith(`tests/${session.test_id}/questions/`) && !path.includes(".."));
      if (safePaths.length) {
        const removed = await admin.storage.from(storageBucket).remove(safePaths);
        if (removed.error) { logError("Не удалось очистить Storage старого импорта:", removed.error); continue; }
      }
    }
    const removedSession = await admin.from("test_import_sessions").delete().eq("test_id", session.test_id).eq("admin_id", adminId).eq("cleanup_pending", true);
    if (removedSession.error) logError("Не удалось завершить cleanup session старого импорта:", removedSession.error);
  }
}

async function hasImportDependents(admin: ReturnType<typeof createAdminClient>, testId: string) {
  const [questions, assignments] = await Promise.all([
    admin.from("test_questions").select("id").eq("test_id", testId).limit(1),
    admin.from("test_assignments").select("id").eq("source_test_id", testId).limit(1),
  ]);
  if (questions.error || assignments.error) {
    logError("Не удалось проверить вопросы или назначения импорта:", questions.error ?? assignments.error);
    return { ok: false as const };
  }
  return { ok: true as const, found: Boolean(questions.data?.length || assignments.data?.length) };
}

async function cleanupImport(
  admin: ReturnType<typeof createAdminClient>,
  payload: ImportToken,
): Promise<CleanupResult> {
  const { data: test, error: testError } = await admin
    .from("tests")
    .select("id,created_by,status,created_at")
    .eq("id", payload.testId)
    .eq("created_by", payload.adminId)
    .eq("status", "DRAFT")
    .eq("created_at", payload.createdAt)
    .maybeSingle();

  if (testError) {
    logError("Не удалось подтвердить черновик импорта перед cleanup:", testError);
    return { ok: false, message: "Не удалось проверить черновик импорта перед очисткой." };
  }
  if (!test) return { ok: true };
  const dependents = await hasImportDependents(admin, payload.testId);
  if (!dependents.ok) return { ok: false, message: "Не удалось проверить содержимое черновика импорта." };
  if (dependents.found) {
    return { ok: false, message: "Очистка запрещена: тест уже содержит вопросы или назначения." };
  }

  const prefix = importStoragePrefix(payload);
  const listed = await listImportPaths(admin, prefix);
  if (!listed.ok) {
    logError("Не удалось получить список изображений текущего импорта:", listed.error);
    return { ok: false, message: "Не удалось проверить изображения текущего импорта." };
  }
  if (listed.paths.length) {
    const candidates = await admin.rpc("test_import_image_cleanup_candidates", { p_test_id: payload.testId, p_paths: listed.paths, p_admin_id: payload.adminId });
    if (candidates.error) {
      logError("Не удалось проверить refs изображений текущего импорта:", candidates.error);
      return { ok: false, message: "Не удалось проверить использование изображений незавершённого импорта." };
    }
    const safePaths = [...new Set((candidates.data ?? []) as string[])].filter((path) => path.startsWith(`tests/${payload.testId}/questions/`) && !path.includes(".."));
    if (safePaths.length) {
      const { error: storageError } = await admin.storage.from(storageBucket).remove(safePaths);
      if (storageError) {
        logError("Не удалось удалить изображения текущего импорта:", storageError);
        return { ok: false, message: "Не удалось удалить изображения незавершённого импорта." };
      }
    }
  }

  const { data: deleted, error: deleteError } = await admin
    .from("tests")
    .delete()
    .eq("id", payload.testId)
    .eq("created_by", payload.adminId)
    .eq("status", "DRAFT")
    .eq("created_at", payload.createdAt)
    .select("id")
    .maybeSingle();
  if (deleteError) {
    logError("Не удалось удалить черновик текущего импорта:", deleteError);
    return { ok: false, message: "Изображения очищены, но черновик импорта удалить не удалось." };
  }
  if (!deleted) return { ok: false, message: "Черновик импорта изменился и не был удалён." };
  await admin.from("test_import_sessions").delete().eq("test_id", payload.testId).eq("admin_id", payload.adminId);
  return { ok: true };
}

function cleanupFailure(result: CleanupResult) {
  return result.ok ? null : ` ${result.message}`;
}

export async function beginTestImport(raw: string, folderId: string | null): Promise<Result> {
  const ctx = await context();
  if (!ctx) return { ok: false, message: "Недостаточно прав для импорта теста." };
  await cleanupStaleImports(ctx.admin, ctx.id);
  const parsed = parseTestImport(raw);
  if (!parsed.ok) return { ok: false, message: "Исправьте ошибки в JSON.", errors: parsed.errors };
  if (!await validFolder(ctx.admin, folderId, ctx.id)) return { ok: false, message: "Текущая папка не найдена или недоступна." };
  const testId = randomUUID();
  const nonce = randomUUID();
  const storagePrefix = `tests/${testId}/questions/import-${nonce}`;
  const { data, error } = await ctx.admin.rpc("begin_test_import_atomic", { p_test_id: testId, p_admin_id: ctx.id, p_folder_id: folderId, p_title: parsed.value.title, p_description: parsed.value.description || null, p_storage_prefix: storagePrefix });
  if (error) { logError("Не удалось атомарно создать import draft:", error); return { ok: false, message: "Не удалось создать черновик теста." }; }
  const result = data as { status?: string; created_at?: string } | null;
  if (result?.status !== "created" || !result.created_at) return { ok: false, message: result?.status === "folder_not_found" ? "Текущая папка не найдена или недоступна." : "Не удалось создать защищённую сессию импорта." };
  const importToken = signImportToken({ version: 1, testId, adminId: ctx.id, createdAt: result.created_at, rawDigest: digestTestImport(raw), nonce });
  return { ok: true, testId, importToken };
}

export async function finishTestImport(testId: string, importToken: string, raw: string, folderId: string | null, refs: ImageRef[]): Promise<Result> {
  const ctx = await context();
  const payload = ctx && uuid.test(testId) ? verifyImportToken(importToken, testId, ctx.id) : null;
  if (!ctx || !payload) return { ok: false, message: "Недостаточно прав для завершения импорта теста." };
  const session = await ctx.admin.from("test_import_sessions").select("test_id").eq("test_id", testId).eq("admin_id", ctx.id).eq("storage_prefix", importStoragePrefix(payload)).eq("cleanup_pending", false).maybeSingle();
  if (session.error || !session.data) return { ok: false, message: "Сессия импорта не найдена." };
  const parsed = parseTestImport(raw);
  if (!parsed.ok) {
    const cleanup = await cleanupImport(ctx.admin, payload);
    return { ok: false, message: `JSON изменился и больше не проходит проверку.${cleanupFailure(cleanup) ?? ""}`, errors: parsed.errors };
  }
  if (!await validFolder(ctx.admin, folderId, ctx.id)) {
    const cleanup = await cleanupImport(ctx.admin, payload);
    return { ok: false, message: `Текущая папка не найдена или недоступна.${cleanupFailure(cleanup) ?? ""}` };
  }
  const { data: test, error: testError } = await ctx.admin.from("tests").select("id").eq("id", testId).eq("created_by", ctx.id).eq("status", "DRAFT").eq("created_at", payload.createdAt).maybeSingle();
  if (testError) logError("Не удалось подтвердить черновик импорта:", testError);
  if (testError || !test) return { ok: false, message: "Незавершённый черновик импорта не найден." };
  const dependents = await hasImportDependents(ctx.admin, testId);
  if (!dependents.ok || dependents.found) return { ok: false, message: "Незавершённый черновик импорта не найден." };

  const prefix = `${importStoragePrefix(payload)}/`;
  const required = new Set(parsed.value.images.map((item) => item.filename));
  const map: Record<string, string> = {};
  for (const ref of refs) {
    if (!required.has(ref.filename) || map[ref.filename] || typeof ref.path !== "string" || !ref.path.startsWith(prefix) || ref.path.includes("..") || ref.path.slice(prefix.length).includes("/")) {
      const cleanup = await cleanupImport(ctx.admin, payload);
      return { ok: false, message: `Изображения не прошли серверную проверку.${cleanupFailure(cleanup) ?? ""}` };
    }
    map[ref.filename] = ref.path;
  }
  if (required.size !== refs.length || [...required].some((name) => !map[name])) {
    const cleanup = await cleanupImport(ctx.admin, payload);
    return { ok: false, message: `Загружены не все нужные изображения.${cleanupFailure(cleanup) ?? ""}` };
  }

  const listed = await listImportPaths(ctx.admin, importStoragePrefix(payload));
  if (!listed.ok) {
    logError("Не удалось проверить Storage текущего импорта:", listed.error);
    return { ok: false, message: "Не удалось проверить загруженные изображения импорта." };
  }
  const suppliedPaths = new Set(Object.values(map));
  if (listed.paths.length !== suppliedPaths.size || listed.paths.some((path) => !suppliedPaths.has(path))) {
    const cleanup = await cleanupImport(ctx.admin, payload);
    return { ok: false, message: `Набор изображений импорта не прошёл серверную проверку.${cleanupFailure(cleanup) ?? ""}` };
  }

  const saved = await saveTestEditor(testId, importedToEditor(parsed.value, testId, folderId, map));
  if (!saved.ok) {
    const cleanup = await cleanupImport(ctx.admin, payload);
    return { ok: false, message: `${saved.message}${cleanupFailure(cleanup) ?? ""}` };
  }
  await ctx.admin.from("test_import_sessions").delete().eq("test_id", testId).eq("admin_id", ctx.id);
  revalidatePath(folderId ? `/admin/tests/folders/${folderId}` : "/admin/tests");
  return { ok: true, testId, importToken };
}

export async function cancelTestImport(testId: string, importToken: string): Promise<CleanupResult> {
  const ctx = await context();
  const payload = ctx && uuid.test(testId) ? verifyImportToken(importToken, testId, ctx.id) : null;
  if (!ctx || !payload) return { ok: false, message: "Недостаточно прав для отмены импорта." };
  return cleanupImport(ctx.admin, payload);
}
