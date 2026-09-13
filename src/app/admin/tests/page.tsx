import type { Metadata } from "next";
import { PageContent, PageHeader, PageShell } from "@/components/page-layout/page-layout";
import { parseLibrarySort } from "@/lib/library-sort";
import { loadTestLibrary } from "@/lib/tests/load-test-library";
import TestLibraryExplorer from "./test-library-explorer";
import styles from "./tests.module.css";

export const metadata: Metadata = { title: "Тесты — AKEDA", description: "Библиотека тестов AKEDA." };

export default async function TestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sort = parseLibrarySort((await searchParams).sort);
  const library = await loadTestLibrary();
  if (library.error) return <PageShell><PageHeader title="Тесты" description="Управление тестами и библиотекой."/><PageContent><div className={styles.queryError}>Не удалось загрузить библиотеку тестов.{process.env.NODE_ENV === "development" && <code>{library.error.code || "Supabase error"}: {library.error.message}</code>}</div></PageContent></PageShell>;
  return <TestLibraryExplorer initialFolderId={null} initialFolders={library.folders} initialTests={library.tests} sort={sort}/>;
}
