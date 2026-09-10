"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";

export type CreateStudentState = {
  status: "idle" | "error" | "success";
  message: string;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function rollbackCreatedAuthUser(admin: ReturnType<typeof createAdminClient>, userId: string, operation: string) {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error("STUDENT_CREATE_ROLLBACK_AUTH", { operation });
    return false;
  }
  return true;
}

export async function createStudent(
  previousState: CreateStudentState,
  formData: FormData,
): Promise<CreateStudentState> {
  void previousState;

  const current = await getCurrentProfile();

  if (!current || current.profile?.role !== "ADMIN") {
    return {
      status: "error",
      message: "Недостаточно прав для создания ученика.",
    };
  }

  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!fullName) {
    return { status: "error", message: "Введите имя ученика." };
  }

  if (!emailPattern.test(email)) {
    return { status: "error", message: "Введите корректный email." };
  }

  if (password.length < 8) {
    return {
      status: "error",
      message: "Пароль должен содержать не менее 8 символов.",
    };
  }

  const admin = createAdminClient();
  const operation = crypto.randomUUID();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
    },
  });

  if (error) {
    const isDuplicate =
      error.code === "email_exists" ||
      /already (been )?registered|already exists/i.test(error.message);

    return {
      status: "error",
      message: isDuplicate
        ? "Пользователь с таким email уже существует."
        : "Не удалось создать ученика. Попробуйте ещё раз.",
    };
  }

  const existingProfile = await admin.from("profiles").select("id, role").eq("id", data.user.id).maybeSingle();
  let profileFailed = Boolean(existingProfile.error);
  if (!profileFailed && !existingProfile.data) {
    const createdProfile = await admin.from("profiles").insert({
      id: data.user.id,
      email,
      full_name: fullName,
      role: "STUDENT",
      student_status: "ACTIVE",
    });
    profileFailed = Boolean(createdProfile.error);
  } else if (!profileFailed && existingProfile.data?.role !== "STUDENT") {
    profileFailed = true;
  }

  if (profileFailed) {
    console.error("STUDENT_CREATE_PROFILE", { operation });
    const rolledBack = await rollbackCreatedAuthUser(admin, data.user.id, operation);
    return {
      status: "error",
      message: rolledBack
        ? "Не удалось создать профиль ученика. Auth-пользователь удалён; можно повторить операцию."
        : "Профиль не создан, а Auth-пользователя не удалось удалить. Проверьте Auth users перед повторной попыткой.",
    };
  }

  revalidatePath("/admin/students");

  return {
    status: "success",
    message: "Ученик успешно создан.",
  };
}
