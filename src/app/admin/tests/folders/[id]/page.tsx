import { notFound } from "next/navigation";
import { parseLibrarySort } from "@/lib/library-sort";
import { loadTestLibrary } from "@/lib/tests/load-test-library";
import TestLibraryExplorer from "../../test-library-explorer";
import styles from "../../tests.module.css";

export default async function TestFolderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const library = await loadTestLibrary();
  if (library.error) return <div className={styles.queryError}>Не удалось загрузить библиотеку тестов.{process.env.NODE_ENV === "development" && <code>{library.error.code || "Supabase error"}: {library.error.message}</code>}</div>;
  if (!library.folders.some((folder) => folder.id === id)) notFound();
  return <TestLibraryExplorer key={id} initialFolderId={id} initialFolders={library.folders} initialTests={library.tests} sort={parseLibrarySort(query.sort)}/>;
}
