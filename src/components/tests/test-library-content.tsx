import TestCard, { type TestItem } from "./test-card";
import TestFolderCard, { type TestFolderItem } from "./test-folder-card";
import type { LibrarySort } from "@/lib/library-sort";
import styles from "@/app/admin/tests/tests.module.css";

export default function TestLibraryContent({ folders, tests, emptyText, sort, returnTo, onNavigate, onFolderAction }: { folders: TestFolderItem[]; tests: TestItem[]; emptyText: string; sort: LibrarySort; returnTo?: string; onNavigate?: (id: string) => void; onFolderAction?: (kind: "rename" | "move" | "delete", folder: TestFolderItem) => void }) {
  if (folders.length === 0 && tests.length === 0) return <p className={styles.empty}>{emptyText}</p>;

  return (
    <>
      {folders.length > 0 && <section className={styles.zone} aria-labelledby="folders-heading"><div className={styles.zoneHeading}><h2 id="folders-heading">Папки</h2><span>{folders.length}</span></div><div className={styles.folderGrid}>{folders.map((folder) => <TestFolderCard folder={folder} sort={sort} onNavigate={onNavigate} onAction={onFolderAction} key={folder.id} />)}</div></section>}
      {tests.length > 0 && <section className={styles.zone} aria-labelledby="tests-heading"><div className={styles.zoneHeading}><h2 id="tests-heading">Тесты</h2><span>{tests.length}</span></div><div className={styles.testGrid}>{tests.map((test) => <TestCard test={test} returnTo={returnTo} key={test.id} />)}</div></section>}
    </>
  );
}
