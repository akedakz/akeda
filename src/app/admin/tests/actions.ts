"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";

export type CreateItemState = { status: "idle" | "error" | "success"; message: string; item?: { kind: "folder" | "test"; id: string; parentId: string | null; name: string; createdAt: string } };
export type FolderActionResult = { ok: boolean; message: string; summary?: { descendantFolders: number; tests: number }; imagePaths?: string[] };

function logSupabaseError(context: string, error: { code?: string; message: string; details?: string; hint?: string }) {
  console.error(context, { code: error.code, message: error.message, details: error.details, hint: error.hint });
}

async function getAdminContext() {
  const current = await getCurrentProfile();
  if (!current || current.profile?.role !== "ADMIN") return null;
  return { profileId: current.profile.id, admin: createAdminClient() };
}

async function folderExists(admin: ReturnType<typeof createAdminClient>, folderId: string, adminId: string) {
  const { data, error } = await admin.from("test_folders").select("id").eq("id", folderId).eq("created_by", adminId).maybeSingle();
  if (error) logSupabaseError("Не удалось проверить папку тестов:", error);
  return { exists: Boolean(data), error: Boolean(error) };
}

function destinationPath(folderId: string | null) {
  return folderId ? `/admin/tests/folders/${folderId}` : "/admin/tests";
}

export async function createTestFolder(_state: CreateItemState, formData: FormData): Promise<CreateItemState> {
  const context = await getAdminContext();
  if (!context) return { status: "error", message: "Недостаточно прав для создания папки." };

  const name = String(formData.get("name") ?? "").trim();
  const parentId = String(formData.get("parentId") ?? "").trim() || null;
  if (!name) return { status: "error", message: "Введите название папки." };

  if (parentId) {
    const check = await folderExists(context.admin, parentId, context.profileId);
    if (check.error) return { status: "error", message: "Не удалось проверить родительскую папку." };
    if (!check.exists) return { status: "error", message: "Родительская папка не найдена." };
  }

  const { data, error } = await context.admin.from("test_folders").insert({ name, parent_id: parentId, created_by: context.profileId }).select("id, created_at").single();
  if (error) {
    logSupabaseError("Не удалось создать папку тестов:", error);
    return { status: "error", message: "Не удалось создать папку." };
  }

  revalidatePath(destinationPath(parentId));
  return { status: "success", message: "Папка создана.", item: { kind: "folder", id: data.id, parentId, name, createdAt: data.created_at } };
}

export async function createTest(_state: CreateItemState, formData: FormData): Promise<CreateItemState> {
  const context = await getAdminContext();
  if (!context) return { status: "error", message: "Недостаточно прав для создания теста." };

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const folderId = String(formData.get("folderId") ?? "").trim() || null;
  if (!title) return { status: "error", message: "Введите название теста." };

  if (folderId) {
    const check = await folderExists(context.admin, folderId, context.profileId);
    if (check.error) return { status: "error", message: "Не удалось проверить папку." };
    if (!check.exists) return { status: "error", message: "Папка не найдена." };
  }

  const { data, error } = await context.admin.from("tests").insert({ title, description, folder_id: folderId, status: "PUBLISHED", created_by: context.profileId }).select("id, created_at").single();
  if (error) {
    logSupabaseError("Не удалось создать тест:", error);
    return { status: "error", message: "Не удалось создать тест." };
  }

  revalidatePath(destinationPath(folderId));
  redirect(`/admin/tests/${data.id}`);
}

export async function renameTestFolder(folderId: string, rawName: string): Promise<FolderActionResult> {
  const context = await getAdminContext();
  if (!context) return { ok: false, message: "Недостаточно прав." };
  const name = rawName.trim();
  if (!name) return { ok: false, message: "Введите название папки." };
  const { data, error } = await context.admin.from("test_folders").update({ name }).eq("id", folderId).select("id").maybeSingle();
  if (error || !data) { if (error) logSupabaseError("Не удалось переименовать папку:", error); return { ok: false, message: "Не удалось переименовать папку." }; }
  revalidatePath("/admin/tests", "layout");
  return { ok: true, message: "Папка переименована." };
}

export async function moveTestFolder(folderId: string, parentId: string | null): Promise<FolderActionResult> {
  const context = await getAdminContext();
  if (!context) return { ok: false, message: "Недостаточно прав." };
  const { data, error } = await context.admin.rpc("move_test_folder_safe", { p_folder_id: folderId, p_parent_id: parentId });
  if (error) { logSupabaseError("Не удалось переместить папку:", error); return { ok: false, message: "Не удалось переместить папку. Убедитесь, что SQL-функция установлена." }; }
  const result = data as { status?: string } | null;
  if (result?.status === "cycle") return { ok: false, message: "Нельзя переместить папку внутрь самой себя или дочерней папки." };
  if (result?.status !== "moved") return { ok: false, message: "Папка или место назначения не найдены." };
  revalidatePath("/admin/tests", "layout");
  return { ok: true, message: "Папка перемещена." };
}

export async function inspectTestFolderDeletion(folderId: string): Promise<FolderActionResult> {
  const context = await getAdminContext();
  if (!context) return { ok: false, message: "Недостаточно прав." };
  const { data, error } = await context.admin.rpc("inspect_test_folder_deletion", { p_folder_id: folderId, p_created_by: context.profileId });
  if (error) { logSupabaseError("Не удалось проверить удаление папки:", error); return { ok: false, message: "Не удалось проверить папку. Убедитесь, что SQL-функция установлена." }; }
  const result = data as { status?: string; descendant_folders?: number; tests?: number } | null;
  if (result?.status !== "ready") return { ok: false, message: "Папка не найдена." };
  return { ok: true, message: "Проверка завершена.", summary: { descendantFolders: result.descendant_folders ?? 0, tests: result.tests ?? 0 } };
}

export async function deleteTestFolder(folderId: string, confirmation: string): Promise<FolderActionResult> {
  const context = await getAdminContext();
  if (!context) return { ok: false, message: "Недостаточно прав." };
  if (confirmation !== "DELETE") return { ok: false, message: "Введите DELETE для подтверждения." };
  const { data, error } = await context.admin.rpc("delete_test_folder_atomic", { p_folder_id: folderId, p_created_by: context.profileId });
  if (error) { logSupabaseError("Не удалось удалить папку:", error); return { ok: false, message: "Не удалось удалить папку. Попробуйте ещё раз." }; }
  const result = data as { status?: string; image_paths?: string[] } | null;
  if (result?.status !== "deleted") return { ok: false, message: "Папка не найдена или не была удалена." };
  const imagePaths = [...new Set(result.image_paths ?? [])].filter((path) => typeof path === "string" && path.startsWith("tests/") && !path.includes(".."));
  if (imagePaths.length) {
    const { error: storageError } = await context.admin.storage.from("test-images").remove(imagePaths);
    if (storageError) logSupabaseError("Папка удалена, но очистка неиспользуемых изображений завершилась ошибкой:", storageError);
  }
  revalidatePath("/admin/tests", "layout");
  return { ok: true, message: "Папка удалена.", imagePaths };
}
