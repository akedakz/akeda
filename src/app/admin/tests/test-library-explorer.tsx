"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import LibrarySortMenu from "@/components/admin/library-sort-menu";
import TestLibraryContent from "@/components/tests/test-library-content";
import type { TestFolderItem } from "@/components/tests/test-folder-card";
import type { TestLibraryFolder, TestLibraryTest } from "@/lib/tests/load-test-library";
import { sortLibraryItems, type LibrarySort, withSort } from "@/lib/library-sort";
import { releasePending, tryAcquirePending } from "@/lib/ui/pending-guard";
import { deleteTestFolder, inspectTestFolderDeletion, moveTestFolder, renameTestFolder, type CreateItemState, type FolderActionResult } from "./actions";
import TestCreatePanel from "./test-create-panel";
import styles from "./tests.module.css";

type Modal = { kind: "rename" | "move" | "delete"; folder: TestFolderItem } | null;

export default function TestLibraryExplorer({ initialFolderId, initialFolders, initialTests, sort }: { initialFolderId: string | null; initialFolders: TestLibraryFolder[]; initialTests: TestLibraryTest[]; sort: LibrarySort }) {
  const [folderId, setFolderId] = useState(initialFolderId);
  const [folders, setFolders] = useState(initialFolders);
  const [tests, setTests] = useState(initialTests);
  const [modal, setModal] = useState<Modal>(null);
  const [name, setName] = useState("");
  const [destination, setDestination] = useState<string>("");
  const [confirmation, setConfirmation] = useState("");
  const [result, setResult] = useState<FolderActionResult | null>(null);
  const [pending, setPending] = useState(false);
  const [recentId, setRecentId] = useState<string | null>(null);
  const pendingGuard = useRef(false);

  const byId = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const chain = useMemo(() => { const items: TestLibraryFolder[] = []; const seen = new Set<string>(); let id = folderId; while (id && !seen.has(id)) { seen.add(id); const folder = byId.get(id); if (!folder) break; items.unshift(folder); id = folder.parentId; } return items; }, [byId, folderId]);
  const current = folderId ? byId.get(folderId) : null;
  const children = useMemo(() => promoteRecent(sortLibraryItems(folders.filter((folder) => folder.parentId === folderId), sort, (item) => item.name, (item) => item.createdAt), recentId), [folderId, folders, recentId, sort]);
  const visibleTests = useMemo(() => promoteRecent(sortLibraryItems(tests.filter((test) => test.folderId === folderId), sort, (item) => item.title, (item) => item.created_at), recentId), [folderId, recentId, sort, tests]);
  const counts = (folder: TestLibraryFolder): TestFolderItem => ({ ...folder, childFolderCount: folders.filter((item) => item.parentId === folder.id).length, testCount: tests.filter((item) => item.folderId === folder.id).length });

  const navigate = (id: string | null, replace = false) => { const href = withSort(id ? `/admin/tests/folders/${id}` : "/admin/tests", sort); window.history[replace ? "replaceState" : "pushState"](null, "", href); setFolderId(id); setRecentId(null); setModal(null); };
  useEffect(() => { const pop = () => { const match = window.location.pathname.match(/^\/admin\/tests\/folders\/([^/]+)$/); setFolderId(match?.[1] ?? null); setRecentId(null); }; window.addEventListener("popstate", pop); return () => window.removeEventListener("popstate", pop); }, []);

  const descendants = (id: string) => { const found = new Set<string>(); const visit = (parent: string) => folders.filter((item) => item.parentId === parent).forEach((item) => { if (!found.has(item.id)) { found.add(item.id); visit(item.id); } }); visit(id); return found; };
  const closeModal = () => { if (!pendingGuard.current) setModal(null); };
  const runFolderAction = async (action: () => Promise<FolderActionResult>) => {
    if (!tryAcquirePending(pendingGuard)) return null;
    setPending(true);
    try { return await action(); }
    catch { return { ok: false, message: "Не удалось выполнить действие с папкой." }; }
    finally { releasePending(pendingGuard); setPending(false); }
  };
  const openAction = async (kind: "rename" | "move" | "delete", folder: TestFolderItem) => { if (pendingGuard.current) return; setModal({ kind, folder }); setName(folder.name); setDestination(folder.parentId ?? ""); setConfirmation(""); setResult(null); if (kind === "delete") { const response = await runFolderAction(() => inspectTestFolderDeletion(folder.id)); if (response) setResult(response); } };
  const finishRename = async () => { if (!modal) return; const current = modal; const response = await runFolderAction(() => renameTestFolder(current.folder.id, name)); if (!response) return; setResult(response); if (response.ok) { setFolders((items) => items.map((item) => item.id === current.folder.id ? { ...item, name: name.trim() } : item)); setModal(null); } };
  const finishMove = async () => { if (!modal) return; const current = modal, parentId = destination || null; const response = await runFolderAction(() => moveTestFolder(current.folder.id, parentId)); if (!response) return; setResult(response); if (response.ok) { setFolders((items) => items.map((item) => item.id === current.folder.id ? { ...item, parentId } : item)); setModal(null); } };
  const finishDelete = async () => { if (!modal) return; const current = modal; const response = await runFolderAction(() => deleteTestFolder(current.folder.id, confirmation)); if (!response) return; setResult(response); if (response.ok) { const removed = descendants(current.folder.id); removed.add(current.folder.id); setFolders((items) => items.filter((item) => !removed.has(item.id))); setTests((items) => items.filter((item) => !item.folderId || !removed.has(item.folderId))); setModal(null); } };
  const created = (state: CreateItemState) => { const item = state.item; if (!item) return; setRecentId(item.id); if (item.kind === "folder") setFolders((items) => [...items, { id: item.id, parentId: item.parentId, name: item.name, createdAt: item.createdAt }]); else setTests((items) => [...items, { id: item.id, folderId: item.parentId, title: item.name, description: null, created_at: item.createdAt, updated_at: null, questionCount: 0, maxPoints: 0 }]); };
  const blockedDestinations = modal ? descendants(modal.folder.id) : new Set<string>();

  const breadcrumb = <><button type="button" onClick={() => navigate(null)}>Тесты</button>{chain.map((item, index) => <span className={styles.breadcrumbItem} key={item.id}><span aria-hidden="true">/</span>{index === chain.length - 1 ? <span aria-current="page">{item.name}</span> : <button type="button" onClick={() => navigate(item.id)}>{item.name}</button>}</span>)}</>;
  return <>
    <TestCreatePanel currentFolderId={folderId} title={current?.name ?? "Тесты"} subtitle={current ? "Содержимое текущей папки." : "Папки, материалы и будущие задания в одном месте."} breadcrumb={breadcrumb} backHref={current ? withSort(current.parentId ? `/admin/tests/folders/${current.parentId}` : "/admin/tests", sort) : undefined} onCreated={created}>
      <LibrarySortMenu value={sort}/>
      <TestLibraryContent folders={children.map(counts)} tests={visibleTests} emptyText={current ? "В этой папке пока нет подпапок и тестов" : "Создайте первую папку или тест"} sort={sort} returnTo={withSort(folderId ? `/admin/tests/folders/${folderId}` : "/admin/tests", sort)} onNavigate={(id) => navigate(id)} onFolderAction={openAction}/>
    </TestCreatePanel>
    {modal && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}><section className={styles.folderDialog} role="dialog" aria-modal="true" aria-labelledby="folder-dialog-title" aria-busy={pending} onKeyDown={(event) => { if (event.key !== "Escape") return; if (pendingGuard.current) { event.preventDefault(); event.stopPropagation(); } else closeModal(); }}>
      <h2 id="folder-dialog-title">{modal.kind === "rename" ? "Переименовать папку" : modal.kind === "move" ? "Переместить папку" : `Удалить «${modal.folder.name}»?`}</h2>
      {modal.kind === "rename" && <label>Название<input autoFocus value={name} onChange={(event) => setName(event.target.value)}/></label>}
      {modal.kind === "move" && <label>Новая родительская папка<select autoFocus value={destination} onChange={(event) => setDestination(event.target.value)}><option value="">Тесты (корень)</option>{folders.filter((item) => item.id !== modal.folder.id && !blockedDestinations.has(item.id)).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}
      {modal.kind === "delete" && <>{pending && <p>Проверяем содержимое…</p>}{result?.summary && <><p>Будет удалено:<br/>{result.summary.descendantFolders} вложенных папок и {result.summary.tests} тестов.</p><p>Назначения и результаты учеников сохранятся.</p></>}{result?.ok && <label>Введите DELETE для подтверждения<input autoFocus value={confirmation} onChange={(event) => setConfirmation(event.target.value)}/></label>}</>}
      {result && !result.ok && <p className={styles.formError} role="alert">{result.message}</p>}
      <div className={styles.dialogActions}>{modal.kind === "rename" && <button className={styles.primaryButton} disabled={pending || !name.trim()} type="button" onClick={finishRename}>Сохранить</button>}{modal.kind === "move" && <button className={styles.primaryButton} disabled={pending} type="button" onClick={finishMove}>Переместить</button>}{modal.kind === "delete" && <button className={styles.dangerButton} disabled={pending || !result?.ok || confirmation !== "DELETE"} type="button" onClick={finishDelete}>{pending ? "Удаляем…" : "Удалить"}</button>}<button className={styles.secondaryButton} type="button" disabled={pending} onClick={closeModal}>Отмена</button></div>
    </section></div>}
  </>;
}

function promoteRecent<T extends { id: string }>(items: T[], recentId: string | null) { if (!recentId) return items; const index = items.findIndex((item) => item.id === recentId); if (index <= 0) return items; return [items[index], ...items.slice(0, index), ...items.slice(index + 1)]; }
