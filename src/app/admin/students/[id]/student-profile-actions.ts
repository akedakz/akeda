"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { StudentProfileActionResult } from "@/components/students/student-profile-types";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StudentStatus } from "@/types/profile";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const allowedStatuses: StudentStatus[] = ["ACTIVE", "PAUSED", "ARCHIVED"];

function safeError(error: { name?: string; status?: number; code?: string; message: string }) {
  return { name: error.name, status: error.status, code: error.code, message: error.message };
}

async function getAdminContext() {
  const current = await getCurrentProfile();
  if (!current || current.profile?.role !== "ADMIN") return null;
  return { profileId: current.profile.id, admin: createAdminClient() };
}

async function emailBelongsToAnotherUser(admin: ReturnType<typeof createAdminClient>, email: string, studentId: string) {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return { error };
    const duplicate = data.users.some((user) => user.id !== studentId && user.email?.toLowerCase() === email);
    if (duplicate) return { duplicate: true };
    if (data.users.length < 1000) return { duplicate: false };
  }
  return { error: new Error("Превышен предел проверки списка Auth users.") };
}

export async function updateStudentProfile(studentId: string, formData: FormData): Promise<StudentProfileActionResult> {
  const context = await getAdminContext();
  if (!context) return { ok: false, message: "Недостаточно прав для изменения ученика." };
  if (!uuidPattern.test(studentId)) return { ok: false, message: "Некорректный идентификатор ученика." };

  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const status = String(formData.get("status") ?? "") as StudentStatus;
  if (!fullName) return { ok: false, message: "Введите имя ученика." };
  if (fullName.length > 120) return { ok: false, message: "Имя не должно превышать 120 символов." };
  if (!emailPattern.test(email)) return { ok: false, message: "Введите корректный email." };
  if (!allowedStatuses.includes(status)) return { ok: false, message: "Выберите корректный статус." };

  const { data: profile, error: profileError } = await context.admin.from("profiles").select("id, email, role").eq("id", studentId).maybeSingle();
  if (profileError) {
    console.error("Не удалось загрузить профиль перед обновлением:", safeError(profileError));
    return { ok: false, message: "Не удалось проверить профиль ученика." };
  }
  if (!profile || profile.role !== "STUDENT") return { ok: false, message: "Ученик не найден." };

  const { data: authData, error: authError } = await context.admin.auth.admin.getUserById(studentId);
  if (authError || !authData.user) {
    if (authError) console.error("Не удалось загрузить Auth user ученика:", safeError(authError));
    return { ok: false, message: "Auth-пользователь ученика не найден. Изменения не сохранены." };
  }
  const oldEmail = authData.user.email?.toLowerCase() ?? profile.email?.toLowerCase() ?? "";
  const emailChanged = email !== oldEmail;

  if (emailChanged) {
    const uniqueness = await emailBelongsToAnotherUser(context.admin, email, studentId);
    if (uniqueness.error) {
      console.error("Не удалось проверить уникальность email в Auth:", safeError(uniqueness.error));
      return { ok: false, message: "Не удалось проверить доступность email." };
    }
    if (uniqueness.duplicate) return { ok: false, message: "Этот email уже используется другим пользователем." };
    const { error } = await context.admin.auth.admin.updateUserById(studentId, { email, email_confirm: true });
    if (error) {
      console.error("Не удалось обновить email Auth user:", safeError(error));
      return { ok: false, message: error.message.toLowerCase().includes("already") ? "Этот email уже используется другим пользователем." : "Не удалось обновить email ученика." };
    }
  }

  const { data: updatedProfile, error: updateError } = await context.admin.from("profiles").update({ full_name: fullName, email, student_status: status }).eq("id", studentId).eq("role", "STUDENT").select("id").maybeSingle();
  if (updateError || !updatedProfile) {
    console.error("Не удалось обновить public.profiles ученика:", updateError ? safeError(updateError) : { message: "Профиль перестал быть STUDENT во время обновления." });
    if (emailChanged && oldEmail) {
      const { error: rollbackError } = await context.admin.auth.admin.updateUserById(studentId, { email: oldEmail, email_confirm: true });
      if (rollbackError) {
        console.error("Критическая ошибка rollback email Auth user:", safeError(rollbackError));
        return { ok: false, message: "Профиль не обновлён, а email в Auth не удалось восстановить. Требуется проверка администратором." };
      }
      return { ok: false, message: "Профиль не обновлён. Email в Auth восстановлен до прежнего значения." };
    }
    return { ok: false, message: "Не удалось обновить данные ученика." };
  }

  revalidatePath(`/admin/students/${studentId}`);
  revalidatePath("/admin/students");
  return { ok: true, message: "Данные ученика обновлены", profile: { fullName, email, status } };
}

export async function updateStudentPassword(studentId: string, formData: FormData): Promise<StudentProfileActionResult> {
  const context = await getAdminContext();
  if (!context) return { ok: false, message: "Недостаточно прав для изменения пароля." };
  if (!uuidPattern.test(studentId)) return { ok: false, message: "Некорректный идентификатор ученика." };
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("passwordConfirmation") ?? "");
  if (password.length < 8) return { ok: false, message: "Пароль должен содержать минимум 8 символов." };
  if (password !== confirmation) return { ok: false, message: "Пароли не совпадают." };

  const { data: profile, error: profileError } = await context.admin.from("profiles").select("id, role").eq("id", studentId).maybeSingle();
  if (profileError) console.error("Не удалось проверить ученика перед сменой пароля:", safeError(profileError));
  if (profileError || !profile || profile.role !== "STUDENT") return { ok: false, message: "Ученик не найден." };
  const { error } = await context.admin.auth.admin.updateUserById(studentId, { password });
  if (error) {
    console.error("Не удалось изменить пароль Auth user:", safeError(error));
    return { ok: false, message: "Не удалось изменить пароль ученика." };
  }
  return { ok: true, message: "Пароль изменён" };
}

export async function deleteStudent(studentId: string, formData: FormData): Promise<StudentProfileActionResult> {
  const context = await getAdminContext();
  if (!context) return { ok: false, message: "Недостаточно прав для удаления ученика." };
  if (!uuidPattern.test(studentId)) return { ok: false, message: "Некорректный идентификатор ученика." };
  if (studentId === context.profileId) return { ok: false, message: "Нельзя удалить текущего администратора." };
  if (String(formData.get("confirmation") ?? "") !== "DELETE") return { ok: false, message: "Введите DELETE для подтверждения." };

  const { data: profile, error: profileError } = await context.admin.from("profiles").select("id, role").eq("id", studentId).maybeSingle();
  if (profileError) console.error("Не удалось проверить ученика перед удалением:", safeError(profileError));
  if (profileError || !profile || profile.role !== "STUDENT") return { ok: false, message: "Ученик не найден." };
  const { data: authData, error: authLookupError } = await context.admin.auth.admin.getUserById(studentId);
  if (authLookupError || !authData.user) {
    if (authLookupError) console.error("Обнаружен профиль без доступного Auth user:", safeError(authLookupError));
    return { ok: false, message: "Auth-пользователь не найден. Профиль не удалён; требуется проверка администратором." };
  }
  const mistakeImages = await context.admin.rpc("student_mistake_image_paths_for_deletion", { p_student_id: studentId, p_admin_id: context.profileId });
  if (mistakeImages.error) {
    console.error("Не удалось подготовить cleanup изображений работы над ошибками:", safeError(mistakeImages.error));
    return { ok: false, message: "Не удалось подготовить удаление данных ученика." };
  }
  const { error } = await context.admin.auth.admin.deleteUser(studentId);
  if (error) {
    console.error("Не удалось удалить Auth user ученика:", safeError(error));
    return { ok: false, message: "Не удалось удалить ученика." };
  }
  const cleanup = await context.admin.rpc("student_mistake_image_cleanup_after_student_deletion", { p_student_id: studentId, p_paths: mistakeImages.data ?? [], p_admin_id: context.profileId });
  if (cleanup.error) console.error("Ученик удалён, но cleanup изображений работы над ошибками завершился ошибкой:", safeError(cleanup.error));
  else {
    const safePaths = [...new Set((cleanup.data ?? []) as string[])].filter((path) => path.startsWith("tests/") && !path.includes(".."));
    if (safePaths.length) {
      const removed = await context.admin.storage.from("test-images").remove(safePaths);
      if (removed.error) console.error("Ученик удалён, но Storage cleanup изображений работы над ошибками завершился ошибкой:", safeError(removed.error));
    }
  }
  revalidatePath("/admin/students");
  redirect("/admin/students?deleted=1");
}
