"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";

export type MaterialType = "FILE" | "LINK" | "VIDEO" | "TEXT";
export type ActionResult = { ok: true; message: string; item?: { kind: "folder" | "material"; id: string; parentId: string | null; name: string; createdAt: string; type?: MaterialType } } | { ok: false; message: string };
export type MaterialFolderActionResult = { ok: boolean; message: string; summary?: { descendantFolders: number; materials: number }; storageErrors?: string[]; storagePaths?: string[] };
type MaterialInput = { folderId: string | null; type: Exclude<MaterialType, "FILE">; title: string; description: string; externalUrl?: string; textContent?: string };
type FileUploadInput = { folderId: string | null; title: string; description: string; originalFileName: string; mimeType: string; fileSize: number };

const maxFileSize = 100 * 1024 * 1024;

function logError(context: string, error: { code?: string; message: string; details?: string; hint?: string }) {
  console.error(context, { code: error.code, message: error.message, details: error.details, hint: error.hint });
}

async function adminContext() {
  const current = await getCurrentProfile();
  if (!current || current.profile?.role !== "ADMIN") return null;
  return { profileId: current.profile.id, admin: createAdminClient() };
}

async function validateFolder(admin: ReturnType<typeof createAdminClient>, folderId: string | null) {
  if (!folderId) return { ok: true as const };
  const { data, error } = await admin.from("material_folders").select("id").eq("id", folderId).maybeSingle();
  if (error) logError("Не удалось проверить папку материалов:", error);
  return error ? { ok: false as const, message: "Не удалось проверить папку." } : data ? { ok: true as const } : { ok: false as const, message: "Папка материалов не найдена." };
}

function destination(folderId: string | null) { return folderId ? `/admin/materials/folders/${folderId}` : "/admin/materials"; }
function validUrl(value: string) { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; } }
function revalidateStudentMaterials() { revalidatePath("/student/materials", "layout"); }

async function cleanupExpiredMaterialUploads(context: NonNullable<Awaited<ReturnType<typeof adminContext>>>) {
  const { data, error } = await context.admin.rpc("prepare_expired_material_upload_cleanup", { p_admin_id: context.profileId });
  if (error) { logError("Не удалось подготовить cleanup истёкших загрузок материалов:", error); return { ok: false as const, message: "Не удалось проверить незавершённые загрузки материалов." }; }
  for (const session of (data ?? []) as Array<{ material_id: string; storage_path: string }>) {
    const removed = await context.admin.storage.from("materials").remove([session.storage_path]);
    if (removed.error) { logError("Не удалось очистить Storage истёкшей загрузки материала:", removed.error); return { ok: false as const, message: "Не удалось очистить истёкшую загрузку материала. Повторите попытку." }; }
    const cleared = await context.admin.from("material_file_upload_sessions").delete().eq("material_id", session.material_id).eq("admin_id", context.profileId);
    if (cleared.error) { logError("Storage очищен, но upload session удалить не удалось:", cleared.error); return { ok: false as const, message: "Файл очищен, но завершить cleanup загрузки не удалось. Повторите попытку." }; }
  }
  return { ok: true as const };
}

export async function createMaterialFolder(nameValue: string, parentId: string | null): Promise<ActionResult> {
  const context = await adminContext();
  if (!context) return { ok: false, message: "Недостаточно прав для создания папки." };
  const name = nameValue.trim();
  if (!name) return { ok: false, message: "Введите название папки." };
  const folder = await validateFolder(context.admin, parentId);
  if (!folder.ok) return folder;
  const { data, error } = await context.admin.from("material_folders").insert({ name, parent_id: parentId, created_by: context.profileId }).select("id, created_at").single();
  if (error) { logError("Не удалось создать папку материалов:", error); return { ok: false, message: "Не удалось создать папку." }; }
  revalidatePath(destination(parentId));
  revalidateStudentMaterials();
  return { ok: true, message: "Папка создана.", item: { kind: "folder", id: data.id, parentId, name, createdAt: data.created_at } };
}

export async function createMaterial(input: MaterialInput): Promise<ActionResult> {
  const context = await adminContext();
  if (!context) return { ok: false, message: "Недостаточно прав для добавления материала." };
  const title = input.title.trim();
  const description = input.description.trim() || null;
  if (!title) return { ok: false, message: "Введите название материала." };
  const folder = await validateFolder(context.admin, input.folderId);
  if (!folder.ok) return folder;
  const externalUrl = input.externalUrl?.trim() || null;
  const textContent = input.textContent?.trim() || null;
  if ((input.type === "LINK" || input.type === "VIDEO") && (!externalUrl || !validUrl(externalUrl))) return { ok: false, message: "Введите корректный адрес с http:// или https://." };
  if (input.type === "TEXT" && !textContent) return { ok: false, message: "Введите текст материала." };
  const { data, error } = await context.admin.from("materials").insert({ folder_id: input.folderId, type: input.type, title, description, external_url: externalUrl, text_content: textContent, created_by: context.profileId }).select("id, created_at").single();
  if (error) { logError("Не удалось создать материал:", error); return { ok: false, message: "Не удалось добавить материал." }; }
  revalidatePath(destination(input.folderId));
  revalidateStudentMaterials();
  return { ok: true, message: "Материал добавлен.", item: { kind: "material", id: data.id, parentId: input.folderId, name: title, createdAt: data.created_at, type: input.type } };
}

export async function beginMaterialFileUpload(input: FileUploadInput): Promise<{ ok: true; materialId: string; path: string; token: string } | { ok: false; message: string }> {
  const context = await adminContext();
  if (!context) return { ok: false, message: "Недостаточно прав для загрузки файла." };
  const cleanup = await cleanupExpiredMaterialUploads(context);
  if (!cleanup.ok) return cleanup;
  if (!input.title.trim()) return { ok: false, message: "Введите название материала." };
  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0 || input.fileSize > maxFileSize) return { ok: false, message: "Размер файла должен быть не больше 100 МБ." };
  const folder = await validateFolder(context.admin, input.folderId);
  if (!folder.ok) return folder;
  const materialId = crypto.randomUUID();
  const extensionMatch = input.originalFileName.match(/\.([a-zA-Z0-9]{1,10})$/);
  const extension = extensionMatch ? `.${extensionMatch[1].toLowerCase()}` : "";
  const path = `materials/${materialId}/${crypto.randomUUID()}${extension}`;
  const { error: sessionError } = await context.admin.from("material_file_upload_sessions").insert({ material_id: materialId, admin_id: context.profileId, folder_id: input.folderId, title: input.title.trim(), description: input.description.trim() || null, original_file_name: input.originalFileName.slice(0, 500), storage_path: path });
  if (sessionError) { logError("Не удалось создать сессию загрузки материала:", sessionError); return { ok: false, message: "Не удалось подготовить загрузку файла." }; }
  const { data, error } = await context.admin.storage.from("materials").createSignedUploadUrl(path);
  if (error) { await context.admin.from("material_file_upload_sessions").delete().eq("material_id", materialId).eq("admin_id", context.profileId); logError("Не удалось создать signed upload URL материала:", error); return { ok: false, message: "Не удалось подготовить загрузку файла." }; }
  return { ok: true, materialId, path, token: data.token };
}

export async function finalizeMaterialFileUpload(materialId: string): Promise<ActionResult> {
  const context = await adminContext();
  if (!context) return { ok: false, message: "Недостаточно прав для сохранения файла." };
  if (!uuidPattern.test(materialId)) return { ok: false, message: "Некорректная сессия загрузки." };
  const { data: session, error: sessionError } = await context.admin.from("material_file_upload_sessions").select("storage_path,folder_id,title").eq("material_id", materialId).eq("admin_id", context.profileId).maybeSingle();
  if (sessionError || !session) return { ok: false, message: "Сессия загрузки не найдена или принадлежит другому администратору." };
  const prefix = `materials/${materialId}`;
  const { data: objects, error: listError } = await context.admin.storage.from("materials").list(prefix, { limit: 2 });
  if (listError) { logError("Не удалось проверить объект материала в Storage:", listError); return { ok: false, message: "Не удалось подтвердить загруженный файл в Storage." }; }
  const expectedName = session.storage_path.slice(prefix.length + 1);
  const object = objects?.find((item) => item.id && item.name === expectedName);
  const metadata = object?.metadata as { size?: number; mimetype?: string } | null | undefined;
  const actualSize = Number(metadata?.size);
  if (!object || !Number.isFinite(actualSize) || actualSize <= 0 || actualSize > maxFileSize) return { ok: false, message: "Загруженный объект отсутствует или имеет недопустимый фактический размер." };
  const { data, error } = await context.admin.rpc("finalize_material_file_upload_atomic", { p_material_id: materialId, p_admin_id: context.profileId, p_storage_path: session.storage_path, p_actual_mime_type: typeof metadata?.mimetype === "string" ? metadata.mimetype : "", p_actual_file_size: actualSize });
  if (error) { logError("Не удалось атомарно завершить загрузку материала:", error); return { ok: false, message: "Файл загружен, но материал не удалось сохранить." }; }
  const result = data as { status?: string; folder_id?: string | null; title?: string } | null;
  if (result?.status !== "created") return { ok: false, message: "Сессия загрузки истекла или объект не прошёл серверную проверку." };
  revalidatePath(destination(result.folder_id ?? null));
  revalidateStudentMaterials();
  return { ok: true, message: "Файл добавлен.", item: { kind: "material", id: materialId, parentId: result.folder_id ?? null, name: result.title ?? session.title, createdAt: new Date().toISOString(), type: "FILE" } };
}

export async function renameMaterialFolder(folderId: string, rawName: string): Promise<MaterialFolderActionResult> {
  const context = await adminContext();
  if (!context) return { ok: false, message: "Недостаточно прав." };
  const name = rawName.trim();
  if (!name) return { ok: false, message: "Введите название папки." };
  const { data, error } = await context.admin.from("material_folders").update({ name }).eq("id", folderId).select("id").maybeSingle();
  if (error || !data) { if (error) logError("Не удалось переименовать папку материалов:", error); return { ok: false, message: "Не удалось переименовать папку." }; }
  revalidatePath("/admin/materials", "layout");
  revalidateStudentMaterials();
  return { ok: true, message: "Папка переименована." };
}

export async function moveMaterialFolder(folderId: string, parentId: string | null): Promise<MaterialFolderActionResult> {
  const context = await adminContext();
  if (!context) return { ok: false, message: "Недостаточно прав." };
  const { data, error } = await context.admin.rpc("move_material_folder_safe", { p_folder_id: folderId, p_parent_id: parentId });
  if (error) { logError("Не удалось переместить папку материалов:", error); return { ok: false, message: "Не удалось переместить папку. Убедитесь, что SQL-функция установлена." }; }
  const status = (data as { status?: string } | null)?.status;
  if (status === "cycle") return { ok: false, message: "Нельзя переместить папку внутрь самой себя или дочерней папки." };
  if (status !== "moved") return { ok: false, message: "Папка или место назначения не найдены." };
  revalidatePath("/admin/materials", "layout");
  revalidateStudentMaterials();
  return { ok: true, message: "Папка перемещена." };
}

export async function inspectMaterialFolderDeletion(folderId: string): Promise<MaterialFolderActionResult> {
  const context = await adminContext();
  if (!context) return { ok: false, message: "Недостаточно прав." };
  const { data, error } = await context.admin.rpc("inspect_material_folder_deletion", { p_folder_id: folderId });
  if (error) { logError("Не удалось проверить удаление папки материалов:", error); return { ok: false, message: "Не удалось проверить папку. Убедитесь, что SQL-функция установлена." }; }
  const result = data as { status?: string; descendant_folders?: number; materials?: number } | null;
  if (result?.status !== "ready") return { ok: false, message: "Папка не найдена." };
  return { ok: true, message: "Проверка завершена.", summary: { descendantFolders: result.descendant_folders ?? 0, materials: result.materials ?? 0 } };
}

export async function deleteMaterialFolder(folderId: string, confirmation: string): Promise<MaterialFolderActionResult> {
  const context = await adminContext();
  if (!context) return { ok: false, message: "Недостаточно прав." };
  if (confirmation !== "УДАЛИТЬ") return { ok: false, message: "Введите УДАЛИТЬ для подтверждения." };
  const { data, error } = await context.admin.rpc("delete_material_folder_with_cleanup_atomic", { p_folder_id: folderId, p_admin_id: context.profileId });
  if (error) { logError("Не удалось удалить папку материалов:", error); return { ok: false, message: "Не удалось удалить папку. Убедитесь, что SQL-функция установлена." }; }
  const result = data as { status?: string; storage_paths?: string[] } | null;
  if (result?.status !== "deleted") return { ok: false, message: "Папка не найдена или не была удалена." };
  const paths = [...new Set(result.storage_paths ?? [])].filter((path) => typeof path === "string" && path.startsWith("materials/") && !path.includes(".."));
  const storageErrors: string[] = [];
  for (let index = 0; index < paths.length; index += 100) {
    const batch = paths.slice(index, index + 100);
    const { error: storageError } = await context.admin.storage.from("materials").remove(batch);
    if (storageError) { logError("Не удалось очистить файлы удалённой папки:", storageError); storageErrors.push(storageError.message); }
    else await context.admin.from("material_storage_cleanup_queue").delete().eq("admin_id", context.profileId).eq("subject_kind", "FOLDER").eq("subject_id", folderId).in("storage_path", batch);
  }
  revalidatePath("/admin/materials", "layout");
  revalidateStudentMaterials();
  return storageErrors.length ? { ok: false, message: "Папка удалена из базы, но часть файлов ожидает повторной очистки Storage.", storageErrors, storagePaths: paths } : { ok: true, message: "Папка и связанные файлы удалены." };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function deleteMaterial(materialId: string): Promise<{ ok: true; message: string; redirectPath: string } | { ok: false; message: string }> {
  const context = await adminContext();
  if (!context) return { ok: false, message: "Недостаточно прав для удаления материала." };
  if (!uuidPattern.test(materialId)) return { ok: false, message: "Некорректный идентификатор материала." };

  const { data, error: deleteError } = await context.admin.rpc("delete_material_with_cleanup_atomic", { p_material_id: materialId, p_admin_id: context.profileId });
  if (deleteError) { logError("Не удалось атомарно удалить материал:", deleteError); return { ok: false, message: "Не удалось удалить материал." }; }
  const result = data as { status?: string; folder_id?: string | null; storage_paths?: string[] } | null;
  if (result?.status !== "deleted") return { ok: false, message: "Материал уже удалён или не найден." };
  const paths = [...new Set(result.storage_paths ?? [])].filter((path) => typeof path === "string" && path.startsWith(`materials/${materialId}/`) && !path.includes(".."));
  if (paths.length) {
    const { error: storageError } = await context.admin.storage.from("materials").remove(paths);
    if (storageError) { logError("Файл материала поставлен в очередь, но Storage cleanup не выполнен:", storageError); return { ok: false, message: "Материал удалён из базы, но файл ожидает повторной очистки Storage." }; }
    const { error: ackError } = await context.admin.from("material_storage_cleanup_queue").delete().eq("admin_id", context.profileId).eq("subject_kind", "MATERIAL").eq("subject_id", materialId).in("storage_path", paths);
    if (ackError) logError("Storage очищен, но cleanup queue не подтверждена:", ackError);
  }
  const redirectPath = destination(result.folder_id ?? null);
  revalidatePath("/admin/materials");
  if (result.folder_id) revalidatePath(`/admin/materials/folders/${result.folder_id}`);
  revalidatePath(`/admin/materials/${materialId}`);
  revalidateStudentMaterials();
  return { ok: true, message: "Материал удалён", redirectPath };
}

export async function getMaterialFileUrl(materialId: string): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const context = await adminContext();
  if (!context) return { ok: false, message: "Недостаточно прав для открытия файла." };
  if (!uuidPattern.test(materialId)) return { ok: false, message: "Некорректный идентификатор материала." };
  const { data, error } = await context.admin.from("materials").select("type, storage_path").eq("id", materialId).maybeSingle();
  if (error) { logError("Не удалось загрузить путь файла:", error); return { ok: false, message: "Не удалось открыть файл." }; }
  if (!data || data.type !== "FILE" || !data.storage_path) return { ok: false, message: "Файл не найден." };
  const { data: signed, error: signedError } = await context.admin.storage.from("materials").createSignedUrl(data.storage_path, 15 * 60);
  if (signedError) { logError("Не удалось создать signed URL материала:", signedError); return { ok: false, message: "Не удалось создать ссылку на файл." }; }
  return { ok: true, url: signed.signedUrl };
}
