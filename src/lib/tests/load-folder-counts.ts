import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

type CountError = { code?: string; message: string; details?: string; hint?: string };

function logError(context: string, error: CountError) {
  console.error(context, { code: error.code, message: error.message, details: error.details, hint: error.hint });
}

export async function loadFolderCounts(admin: ReturnType<typeof createAdminClient>, folderIds: string[]) {
  const folderCounts = new Map<string, number>();
  const testCounts = new Map<string, number>();
  if (folderIds.length === 0) return { folderCounts, testCounts, error: null as CountError | null };

  const [foldersResult, testsResult] = await Promise.all([
    admin.from("test_folders").select("parent_id").in("parent_id", folderIds),
    admin.from("tests").select("folder_id").in("folder_id", folderIds),
  ]);

  if (foldersResult.error) logError("Не удалось подсчитать подпапки:", foldersResult.error);
  if (testsResult.error) logError("Не удалось подсчитать тесты в папках:", testsResult.error);
  for (const row of foldersResult.data ?? []) if (row.parent_id) folderCounts.set(row.parent_id, (folderCounts.get(row.parent_id) ?? 0) + 1);
  for (const row of testsResult.data ?? []) if (row.folder_id) testCounts.set(row.folder_id, (testCounts.get(row.folder_id) ?? 0) + 1);

  return { folderCounts, testCounts, error: foldersResult.error ?? testsResult.error };
}
