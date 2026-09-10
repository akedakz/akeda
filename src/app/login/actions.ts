"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { message: string };

export async function login(previousState: LoginState, formData: FormData): Promise<LoginState> {
  void previousState;
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { message: "Введите электронную почту и пароль." };

  let destination: "/admin" | "/student" | null = null;
  try {
    const supabase = await createClient({ requireCookieWrites: true });
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) return { message: authError.code === "invalid_credentials" ? "Неверный email или пароль." : "Не удалось войти. Попробуйте ещё раз." };
    if (!authData.user || !authData.session) {
      console.error("Supabase signIn завершился без пользователя или сессии.");
      return { message: "Не удалось сохранить сессию. Попробуйте ещё раз." };
    }

    const { data: verified, error: verificationError } = await supabase.auth.getUser();
    if (verificationError || !verified.user || verified.user.id !== authData.user.id) {
      console.error("Новая Supabase-сессия не прошла проверку:", { code: verificationError?.code, message: verificationError?.message });
      await supabase.auth.signOut({ scope: "local" });
      return { message: "Не удалось сохранить сессию. Попробуйте ещё раз." };
    }

    const { data: profile, error: profileError } = await supabase.from("profiles").select("role, student_status").eq("id", verified.user.id).maybeSingle();
    if (profileError) {
      console.error("Не удалось загрузить профиль после входа:", { code: profileError.code, message: profileError.message, details: profileError.details, hint: profileError.hint });
      await supabase.auth.signOut({ scope: "local" });
      return { message: "Не удалось проверить профиль пользователя." };
    }
    if (!profile) {
      await supabase.auth.signOut({ scope: "local" });
      return { message: "Профиль пользователя не найден." };
    }
    if (profile.role === "ADMIN") destination = "/admin";
    else if (profile.role === "STUDENT") {
      if (profile.student_status === "PAUSED") {
        await supabase.auth.signOut({ scope: "local" });
        return { message: "Аккаунт приостановлен." };
      }
      if (profile.student_status === "ARCHIVED") {
        await supabase.auth.signOut({ scope: "local" });
        return { message: "Аккаунт находится в архиве." };
      }
      if (profile.student_status !== "ACTIVE") {
        await supabase.auth.signOut({ scope: "local" });
        return { message: "Аккаунт ученика пока недоступен." };
      }
      destination = "/student";
    } else {
      await supabase.auth.signOut({ scope: "local" });
      return { message: "Не удалось определить роль пользователя." };
    }
  } catch (error) {
    console.error("Ошибка сохранения Supabase-сессии при входе:", { name: error instanceof Error ? error.name : "UnknownError", message: error instanceof Error ? error.message : "Unknown error" });
    return { message: "Не удалось сохранить сессию. Попробуйте ещё раз." };
  }

  if (destination) redirect(destination);
  return { message: "Не удалось войти. Попробуйте ещё раз." };
}
