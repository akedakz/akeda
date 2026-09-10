"use server";

import { revalidatePath } from "next/cache";
import type { LessonActionResult } from "@/components/students/student-lesson-types";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function completeOverviewTopic(studentId: string, topicId: string): Promise<LessonActionResult> {
  const current = await getCurrentProfile();
  if (current?.profile?.role !== "ADMIN") return { ok: false, message: "Недостаточно прав." };
  if (!uuid.test(studentId) || !uuid.test(topicId)) return { ok: false, message: "Некорректная тема." };
  const admin = createAdminClient();
  const [student, currentTopic] = await Promise.all([
    admin.from("profiles").select("id").eq("id", studentId).eq("role", "STUDENT").maybeSingle(),
    admin.from("student_topics").select("id").eq("student_id", studentId).is("completed_at", null).order("sort_order").limit(1).maybeSingle(),
  ]);
  const checkError = student.error ?? currentTopic.error;
  if (checkError) {
    console.error("Не удалось проверить текущую тему Overview:", { code: checkError.code, message: checkError.message, details: checkError.details, hint: checkError.hint });
    return { ok: false, message: "Не удалось проверить тему." };
  }
  if (!student.data) return { ok: false, message: "Ученик не найден." };
  if (!currentTopic.data || currentTopic.data.id !== topicId) return { ok: false, message: "Текущая тема уже изменилась. Обновите страницу." };
  const { error } = await admin.from("student_topics").update({ completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", topicId).eq("student_id", studentId).is("completed_at", null);
  if (error) {
    console.error("Не удалось завершить тему из Overview:", { code: error.code, message: error.message, details: error.details, hint: error.hint });
    return { ok: false, message: "Не удалось завершить тему." };
  }
  revalidatePath("/admin");
  revalidatePath(`/admin/students/${studentId}`);
  return { ok: true, message: "Тема отмечена пройденной" };
}
