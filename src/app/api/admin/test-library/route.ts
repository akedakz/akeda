import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { sortLibraryItems } from "@/lib/library-sort";

type FolderRow = { id: string; parent_id: string | null; name: string; created_at: string };
type TestRow = { id: string; title: string; description: string | null; created_at: string };

function safeError(error: { code?: string; message: string; details?: string; hint?: string }) {
  return { code: error.code, message: error.message, details: error.details, hint: error.hint };
}

function getBreadcrumb(folders: FolderRow[], folder: FolderRow) {
  const byId = new Map(folders.map((item) => [item.id, item]));
  const chain: { id: string; name: string }[] = [];
  const visited = new Set<string>();
  let current: FolderRow | null = folder;
  for (let depth = 0; current && depth < 50; depth += 1) {
    if (visited.has(current.id)) throw new Error("folder_cycle");
    visited.add(current.id);
    chain.unshift({ id: current.id, name: current.name });
    if (!current.parent_id) break;
    current = byId.get(current.parent_id) ?? null;
    if (!current) throw new Error("folder_not_found");
  }
  if (current?.parent_id) throw new Error("folder_depth");
  return chain;
}

export async function GET(request: Request) {
  const current = await getCurrentProfile();
  if (!current || current.profile?.role !== "ADMIN") return NextResponse.json({ message: "Недостаточно прав." }, { status: 403 });

  const searchParams = new URL(request.url).searchParams;
  const folderId = searchParams.get("folderId")?.trim() || null;
  const admin = createAdminClient();
  const allFoldersResult = await admin.from("test_folders").select("id, parent_id, name, created_at");
  if (allFoldersResult.error) {
    console.error("Не удалось загрузить папки библиотеки тестов:", safeError(allFoldersResult.error));
    return NextResponse.json({ message: "Не удалось загрузить библиотеку тестов." }, { status: 500 });
  }
  const allFolders = (allFoldersResult.data ?? []) as FolderRow[];
  let breadcrumb: { id: string; name: string }[] = [];
  if (folderId) {
    const folder = allFolders.find((item) => item.id === folderId);
    if (!folder) return NextResponse.json({ message: "Папка не найдена." }, { status: 404 });
    try { breadcrumb = getBreadcrumb(allFolders, folder); }
    catch (error) {
      console.error("Не удалось построить breadcrumb назначения:", error);
      return NextResponse.json({ message: "Не удалось загрузить путь к папке." }, { status: 500 });
    }
  }

  let testsQuery = folderId ? admin.from("tests").select("id, title, description, created_at").eq("folder_id", folderId) : admin.from("tests").select("id, title, description, created_at").is("folder_id", null);
  testsQuery = testsQuery.eq("is_assignment_copy", false);
  testsQuery = testsQuery.eq("status", "PUBLISHED");
  const testsResult = await testsQuery;
  if (testsResult.error) {
    console.error("Не удалось загрузить библиотеку для назначения:", safeError(testsResult.error));
    return NextResponse.json({ message: "Не удалось загрузить библиотеку тестов." }, { status: 500 });
  }

  const folders = sortLibraryItems(allFolders.filter((item) => item.parent_id === folderId), "created_desc", (item) => item.name, (item) => item.created_at);
  const tests = sortLibraryItems((testsResult.data ?? []) as TestRow[], "created_desc", (item) => item.title, (item) => item.created_at);
  const ids = tests.map((test) => test.id);
  const questionCounts = new Map<string, number>();
  const maxPoints = new Map<string, number>();
  if (ids.length) {
    const { data, error } = await admin.from("test_questions").select("test_id, points").in("test_id", ids);
    if (error) {
      console.error("Не удалось загрузить количество вопросов:", safeError(error));
      return NextResponse.json({ message: "Не удалось загрузить данные тестов." }, { status: 500 });
    }
    for (const row of (data ?? []) as { test_id: string; points: number }[]) {
      questionCounts.set(row.test_id, (questionCounts.get(row.test_id) ?? 0) + 1);
      maxPoints.set(row.test_id, (maxPoints.get(row.test_id) ?? 0) + Number(row.points));
    }
  }

  return NextResponse.json({ breadcrumb, folders, tests: tests.map((test) => ({ ...test, questionCount: questionCounts.get(test.id) ?? 0, maxPoints: maxPoints.get(test.id) ?? 0 })) });
}
