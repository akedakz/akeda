"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function admin() {
  const current = await getCurrentProfile();
  return current?.profile?.role === "ADMIN" ? createAdminClient() : null;
}

function programName(data: FormData) {
  const value = String(data.get("name") ?? "").trim();
  return value && value.length <= 100 ? value : null;
}

function topicTitle(data: FormData) {
  const value = String(data.get("title") ?? "").trim();
  return value && value.length <= 200 ? value : null;
}

function refresh(programId?: string) {
  revalidatePath("/admin/settings");
  revalidatePath("/admin/settings/programs");
  if (programId) revalidatePath(`/admin/settings/programs/${programId}`);
  revalidatePath("/student/profile");
}

export async function createProgram(data: FormData) {
  const client = await admin();
  if (!client) return { ok: false, message: "Недостаточно прав." };
  const name = programName(data);
  if (!name) return { ok: false, message: "Введите название до 100 символов." };

  const result = await client.from("learning_programs").insert({ name });
  if (result.error) {
    return {
      ok: false,
      message: result.error.code === "23505"
        ? "Активная программа с таким названием уже существует."
        : "Не удалось создать программу.",
    };
  }

  refresh();
  return { ok: true, message: "Программа создана." };
}

export async function renameProgram(programId: string, data: FormData) {
  const client = await admin();
  if (!client) return { ok: false, message: "Недостаточно прав." };
  const name = programName(data);
  if (!uuid.test(programId) || !name) return { ok: false, message: "Некорректные данные." };

  const result = await client
    .from("learning_programs")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", programId)
    .eq("is_active", true)
    .select("id")
    .maybeSingle();

  if (result.error || !result.data) {
    return {
      ok: false,
      message: result.error?.code === "23505"
        ? "Активная программа с таким названием уже существует."
        : "Программа не найдена.",
    };
  }

  refresh(programId);
  return { ok: true, message: "Программа переименована." };
}

export async function archiveProgram(id: string) {
  const client = await admin();
  if (!client) return { ok: false, message: "Недостаточно прав." };
  if (!uuid.test(id)) return { ok: false, message: "Некорректная программа." };

  const result = await client
    .from("learning_programs")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("is_active", true);

  if (result.error) return { ok: false, message: "Не удалось архивировать программу." };

  refresh(id);
  return { ok: true, message: "Программа архивирована." };
}

export async function addProgramTopic(programId: string, data: FormData) {
  const client = await admin();
  if (!client) return { ok: false, message: "Недостаточно прав." };
  const title = topicTitle(data);
  if (!uuid.test(programId) || !title) return { ok: false, message: "Введите название темы до 200 символов." };

  const [programResult, lastResult] = await Promise.all([
    client.from("learning_programs").select("id").eq("id", programId).eq("is_active", true).maybeSingle(),
    client
      .from("learning_program_topics")
      .select("sort_order")
      .eq("program_id", programId)
      .order("sort_order", { ascending: false })
      .limit(1),
  ]);

  if (programResult.error || !programResult.data) return { ok: false, message: "Программа не найдена." };
  if (lastResult.error) return { ok: false, message: "Не удалось определить порядок тем." };

  const sortOrder = (lastResult.data?.[0]?.sort_order ?? -1) + 1;
  const result = await client.from("learning_program_topics").insert({
    program_id: programId,
    title,
    sort_order: sortOrder,
  });

  if (result.error) {
    console.error("ADD_PROGRAM_TOPIC", { code: result.error.code, message: result.error.message });
    return { ok: false, message: "Не удалось добавить тему." };
  }

  await client.from("learning_programs").update({ updated_at: new Date().toISOString() }).eq("id", programId);
  refresh(programId);
  return { ok: true, message: "Тема добавлена." };
}

export async function renameProgramTopic(programId: string, topicId: string, data: FormData) {
  const client = await admin();
  if (!client) return { ok: false, message: "Недостаточно прав." };
  const title = topicTitle(data);
  if (!uuid.test(programId) || !uuid.test(topicId) || !title) return { ok: false, message: "Некорректная тема." };

  const result = await client
    .from("learning_program_topics")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", topicId)
    .eq("program_id", programId)
    .select("id")
    .maybeSingle();

  if (result.error || !result.data) return { ok: false, message: "Тема не найдена." };

  await client.from("learning_programs").update({ updated_at: new Date().toISOString() }).eq("id", programId);
  refresh(programId);
  return { ok: true, message: "Тема переименована." };
}

export async function deleteProgramTopic(programId: string, topicId: string) {
  const client = await admin();
  if (!client) return { ok: false, message: "Недостаточно прав." };
  if (!uuid.test(programId) || !uuid.test(topicId)) return { ok: false, message: "Некорректная тема." };

  const removed = await client
    .from("learning_program_topics")
    .delete()
    .eq("id", topicId)
    .eq("program_id", programId)
    .select("id")
    .maybeSingle();

  if (removed.error || !removed.data) return { ok: false, message: "Тема не найдена." };

  const remaining = await client
    .from("learning_program_topics")
    .select("id")
    .eq("program_id", programId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });

  if (remaining.error) return { ok: false, message: "Тема удалена, но порядок не удалось обновить." };

  if (remaining.data.length) {
    const reordered = await client.rpc("reorder_learning_program_topics", {
      p_program_id: programId,
      p_ids: remaining.data.map((item) => item.id),
    });
    if (reordered.error) console.error("NORMALIZE_PROGRAM_TOPICS", reordered.error);
  }

  await client.from("learning_programs").update({ updated_at: new Date().toISOString() }).eq("id", programId);
  refresh(programId);
  return { ok: true, message: "Тема удалена." };
}

export async function reorderProgramTopics(programId: string, ids: string[]) {
  const client = await admin();
  if (!client) return { ok: false, message: "Недостаточно прав." };
  if (
    !uuid.test(programId)
    || !ids.length
    || ids.some((id) => !uuid.test(id))
    || new Set(ids).size !== ids.length
  ) return { ok: false, message: "Некорректный порядок." };

  const result = await client.rpc("reorder_learning_program_topics", {
    p_program_id: programId,
    p_ids: ids,
  });

  if (result.error) {
    console.error("REORDER_PROGRAM_TOPICS", { code: result.error.code, message: result.error.message });
    return { ok: false, message: "Не удалось изменить порядок тем." };
  }

  refresh(programId);
  return { ok: true, message: "Порядок сохранён." };
}
