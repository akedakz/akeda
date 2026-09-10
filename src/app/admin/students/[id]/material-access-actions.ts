"use server";

import { revalidatePath } from "next/cache";
import type { MaterialAccessActionResult } from "@/components/students/student-material-types";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { loadFolderAncestors } from "@/lib/materials/material-tree";
import { createAdminClient } from "@/lib/supabase/admin";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function logError(context: string, error: { code?: string; message: string; details?: string; hint?: string }) { console.error(context, { code: error.code, message: error.message, details: error.details, hint: error.hint }); }
async function context() { const current = await getCurrentProfile(); return current?.profile?.role === "ADMIN" ? { profileId: current.profile.id, admin: createAdminClient() } : null; }
async function studentExists(admin: ReturnType<typeof createAdminClient>, studentId: string) { const result = await admin.from("profiles").select("id").eq("id", studentId).eq("role", "STUDENT").maybeSingle(); return { exists: Boolean(result.data), error: result.error }; }
function refresh(studentId: string) { revalidatePath(`/admin/students/${studentId}`); revalidatePath("/student/materials"); }

export async function grantMaterialFolderAccess(studentId: string, folderId: string): Promise<MaterialAccessActionResult> {
  const ctx = await context(); if (!ctx) return { ok: false, message: "Недостаточно прав." };
  if (!uuidPattern.test(studentId) || !uuidPattern.test(folderId)) return { ok: false, message: "Некорректные данные назначения." };
  const { data, error } = await ctx.admin.rpc("grant_material_folder_access_atomic", { p_student_id: studentId, p_folder_id: folderId, p_admin_id: ctx.profileId });
  if (error) { logError("Атомарное назначение папки завершилось ошибкой:", error); return { ok: false, message: "Не удалось назначить папку." }; }
  const status = (data as { status?: string } | null)?.status;
  if (status === "student_not_found") return { ok: false, message: "Ученик не найден." };
  if (status === "folder_not_found" || status === "forbidden" || status === "foreign_tree") return { ok: false, message: "Папка не найдена, принадлежит другому администратору или содержит чужие данные." };
  if (status === "already_covered") return { ok: true, message: "Папка уже доступна ученику" };
  if (status !== "granted") return { ok: false, message: "Не удалось назначить папку." };
  refresh(studentId); return { ok: true, message: "Папка назначена" };
}

export async function grantMaterialAccess(studentId: string, materialId: string): Promise<MaterialAccessActionResult> {
  const ctx = await context(); if (!ctx) return { ok: false, message: "Недостаточно прав." };
  if (!uuidPattern.test(studentId) || !uuidPattern.test(materialId)) return { ok: false, message: "Некорректные данные назначения." };
  const student = await studentExists(ctx.admin, studentId); if (student.error) { logError("Не удалось проверить ученика:", student.error); return { ok: false, message: "Не удалось проверить ученика." }; } if (!student.exists) return { ok: false, message: "Ученик не найден." };
  const { data: material, error: materialError } = await ctx.admin.from("materials").select("id, folder_id").eq("id", materialId).maybeSingle();
  if (materialError) { logError("Не удалось проверить материал:", materialError); return { ok: false, message: "Не удалось проверить материал." }; } if (!material) return { ok: false, message: "Материал не найден." };
  if (material.folder_id) {
    const ancestors = await loadFolderAncestors(ctx.admin, material.folder_id); if (ancestors.error || !ancestors.data) { console.error("Не удалось проверить путь материала:", ancestors.error); return { ok: false, message: "Не удалось проверить папку материала." }; }
    const ids = ancestors.data.map((folder) => folder.id);
    const { data: folderAccess, error } = await ctx.admin.from("student_material_folder_access").select("folder_id").eq("student_id", studentId).in("folder_id", ids);
    if (error) { logError("Не удалось проверить доступ через папку:", error); return { ok: false, message: "Не удалось проверить существующие доступы." }; }
    const coveringId = folderAccess?.[0]?.folder_id;
    const covering = ancestors.data.find((folder) => folder.id === coveringId);
    if (covering) return { ok: false, message: `Материал уже доступен через папку “${covering.name}”.` };
  }
  const { error } = await ctx.admin.from("student_material_access").insert({ student_id: studentId, material_id: materialId, granted_by: ctx.profileId });
  if (error) { if (error.code === "23505") return { ok: false, message: "Этот материал уже назначен ученику." }; logError("Не удалось назначить материал:", error); return { ok: false, message: "Не удалось назначить материал." }; }
  refresh(studentId); return { ok: true, message: "Материал назначен" };
}

export async function revokeMaterialFolderAccess(studentId: string, accessId: string): Promise<MaterialAccessActionResult> {
  const ctx = await context(); if (!ctx) return { ok: false, message: "Недостаточно прав." }; if (!uuidPattern.test(studentId) || !uuidPattern.test(accessId)) return { ok: false, message: "Некорректные данные доступа." };
  const { data, error: findError } = await ctx.admin.from("student_material_folder_access").select("id").eq("id", accessId).eq("student_id", studentId).maybeSingle(); if (findError) { logError("Не удалось проверить доступ к папке:", findError); return { ok: false, message: "Не удалось проверить доступ." }; } if (!data) return { ok: false, message: "Доступ не найден." };
  const { error } = await ctx.admin.from("student_material_folder_access").delete().eq("id", accessId).eq("student_id", studentId); if (error) { logError("Не удалось отозвать папочный доступ:", error); return { ok: false, message: "Не удалось отозвать доступ." }; } refresh(studentId); return { ok: true, message: "Доступ отозван" };
}

export async function revokeMaterialAccess(studentId: string, accessId: string): Promise<MaterialAccessActionResult> {
  const ctx = await context(); if (!ctx) return { ok: false, message: "Недостаточно прав." }; if (!uuidPattern.test(studentId) || !uuidPattern.test(accessId)) return { ok: false, message: "Некорректные данные доступа." };
  const { data, error: findError } = await ctx.admin.from("student_material_access").select("id").eq("id", accessId).eq("student_id", studentId).maybeSingle(); if (findError) { logError("Не удалось проверить доступ к материалу:", findError); return { ok: false, message: "Не удалось проверить доступ." }; } if (!data) return { ok: false, message: "Доступ не найден." };
  const { error } = await ctx.admin.from("student_material_access").delete().eq("id", accessId).eq("student_id", studentId); if (error) { logError("Не удалось отозвать доступ к материалу:", error); return { ok: false, message: "Не удалось отозвать доступ." }; } refresh(studentId); return { ok: true, message: "Доступ отозван" };
}
