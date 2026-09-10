import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { loadTestSummaries } from "./load-test-summaries";

export type TestLibraryFolder = {
  id: string;
  parentId: string | null;
  name: string;
  createdAt: string;
};

export type TestLibraryTest = {
  id: string;
  folderId: string | null;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string | null;
  questionCount: number;
  maxPoints: number;
};

export async function loadTestLibrary() {
  const admin = createAdminClient();
  const [folderResult, testResult] = await Promise.all([
    admin.from("test_folders").select("id, parent_id, name, created_at"),
    admin.from("tests").select("id, folder_id, title, description, created_at, updated_at").eq("is_assignment_copy", false),
  ]);
  const queryError = folderResult.error ?? testResult.error;
  if (queryError) {
    console.error("Не удалось загрузить дерево тестов:", { code: queryError.code, message: queryError.message, details: queryError.details, hint: queryError.hint });
  }
  const rows = (testResult.data ?? []) as Array<Omit<TestLibraryTest, "questionCount" | "maxPoints"> & { folder_id: string | null }>;
  const summaries = await loadTestSummaries(admin, rows.map((test) => test.id));
  return {
    folders: (folderResult.data ?? []).map((folder) => ({ id: folder.id, parentId: folder.parent_id, name: folder.name, createdAt: folder.created_at })) as TestLibraryFolder[],
    tests: rows.map(({ folder_id, ...test }) => ({ ...test, folderId: folder_id, ...(summaries.summaries.get(test.id) ?? { questionCount: 0, maxPoints: 0 }) })),
    error: queryError ?? summaries.error,
  };
}
