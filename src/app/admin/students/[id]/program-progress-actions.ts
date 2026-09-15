"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function toggleProgramTopicProgress(studentId: string, programTopicId: string) {
  const current = await getCurrentProfile();
  if (current?.profile?.role !== "ADMIN") return { ok: false, message: "Недостаточно прав." };
  if (!uuid.test(studentId) || !uuid.test(programTopicId)) return { ok: false, message: "Некорректная тема." };

  const result = await createAdminClient().rpc("toggle_student_learning_program_topic", {
    p_student_id: studentId,
    p_program_topic_id: programTopicId,
  });

  if (result.error) {
    console.error("TOGGLE_PROGRAM_TOPIC_PROGRESS", {
      code: result.error.code,
      message: result.error.message,
      details: result.error.details,
      hint: result.error.hint,
    });
    return { ok: false, message: "Не удалось изменить статус темы." };
  }

  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath("/student/profile");
  return { ok: true, message: "Прогресс обновлён." };
}
