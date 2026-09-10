"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StudentStatus } from "@/types/profile";

const allowedStatuses: StudentStatus[] = ["ACTIVE", "PAUSED", "ARCHIVED"];

export async function updateStudentStatus(studentId: string, status: StudentStatus) {
  const current = await getCurrentProfile();

  if (!current || current.profile?.role !== "ADMIN") {
    throw new Error("Недостаточно прав для изменения статуса ученика.");
  }

  if (!studentId || !allowedStatuses.includes(status)) {
    throw new Error("Некорректные данные статуса ученика.");
  }

  const admin = createAdminClient();
  const { data: student, error: studentError } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", studentId)
    .eq("role", "STUDENT")
    .maybeSingle();

  if (studentError || !student) {
    throw new Error("Ученик не найден.");
  }

  const { error: updateError } = await admin
    .from("profiles")
    .update({ student_status: status })
    .eq("id", studentId)
    .eq("role", "STUDENT");

  if (updateError) {
    throw new Error("Не удалось изменить статус ученика.");
  }

  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath("/admin/students");
}
