"use server";

import { revalidatePath } from "next/cache";
import { getActiveStudentContext, loadAccessibleMaterial } from "@/lib/materials/student-material-library";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function toggleStudentMaterialPin(materialId: string, pinned: boolean) {
  const context = await getActiveStudentContext();
  if (!context || !uuid.test(materialId)) return { ok: false, message: "Материал недоступен." };
  const material = await loadAccessibleMaterial(context.studentId, materialId);
  if (!material || !["FILE", "LINK"].includes(material.safe.type)) return { ok: false, message: "Материал недоступен." };
  const query = context.admin.from("student_material_pins");
  const result = pinned
    ? await query.upsert({ student_id: context.studentId, material_item_id: materialId }, { onConflict: "student_id,material_item_id" })
    : await query.delete().eq("student_id", context.studentId).eq("material_item_id", materialId);
  if (result.error) return { ok: false, message: "Не удалось сохранить закрепление." };
  revalidatePath("/student/materials");
  return { ok: true, message: pinned ? "Материал закреплён." : "Материал откреплён." };
}
