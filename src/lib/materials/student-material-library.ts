import "server-only";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";

export type StudentMaterialFolder = { id: string; parentId: string | null; name: string };
export type StudentMaterialItem = { id: string; folderId: string | null; type: "FILE" | "LINK" | "VIDEO" | "TEXT"; title: string; description: string | null; originalFileName: string | null; mimeType: string | null; fileSize: number | null; externalUrl: string | null; createdAt: string; pinned: boolean };

type FolderRow = { id: string; parent_id: string | null; name: string };
type MaterialRow = { id: string; folder_id: string | null; type: "FILE" | "LINK" | "VIDEO" | "TEXT"; title: string; description: string | null; storage_path: string | null; original_file_name: string | null; mime_type: string | null; file_size: number | null; external_url: string | null; created_at: string };

export async function getActiveStudentContext() {
  const current = await getCurrentProfile();
  if (!current || current.profile?.role !== "STUDENT" || current.profile.student_status !== "ACTIVE") return null;
  return { studentId: current.user.id, admin: createAdminClient() };
}

export async function loadStudentMaterialLibrary(studentId: string) {
  const admin = createAdminClient();
  const result = await admin.rpc("get_student_material_library", { p_student_id: studentId });
  if (result.error) {
    logSupabaseError("MATERIALS_LOAD_LIBRARY", result.error);
    throw new Error("Не удалось загрузить доступные материалы.");
  }
  const payload = (result.data ?? {}) as { folders?: FolderRow[]; materials?: MaterialRow[]; pins?: string[] };
  const folders = payload.folders ?? [];
  const materials = payload.materials ?? [];
  const pinnedIds = new Set(payload.pins ?? []);
  const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });
  const visibleFolders: StudentMaterialFolder[] = folders.map((folder) => ({ id: folder.id, parentId: folder.parent_id, name: folder.name })).sort((a, b) => collator.compare(a.name, b.name) || compareIds(a.id, b.id));
  const visibleMaterials: StudentMaterialItem[] = materials.map((material) => ({ id: material.id, folderId: material.folder_id, type: material.type, title: material.title, description: material.description, originalFileName: material.original_file_name, mimeType: material.mime_type, fileSize: material.file_size, externalUrl: material.external_url, createdAt: material.created_at, pinned: pinnedIds.has(material.id) })).sort((a, b) => collator.compare(a.title, b.title) || compareIds(a.id, b.id));
  return { folders: visibleFolders, materials: visibleMaterials, rawMaterials: new Map(materials.map((item) => [item.id, item])) };
}

export async function loadAccessibleMaterial(studentId: string, materialId: string) {
  const library = await loadStudentMaterialLibrary(studentId);
  const safe = library.materials.find((item) => item.id === materialId);
  const raw = library.rawMaterials.get(materialId);
  return safe && raw ? { safe, raw } : null;
}

function compareIds(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }

function logSupabaseError(stage: string, error: { code?: string; message: string; details?: string; hint?: string }) {
  console.error(stage, { code: error.code, message: error.message, details: error.details, hint: error.hint });
}
