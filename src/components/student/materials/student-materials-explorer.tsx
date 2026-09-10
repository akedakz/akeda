"use client";

import { useEffect, useMemo, useState } from "react";
import type { StudentMaterialFolder, StudentMaterialItem } from "@/lib/materials/student-material-library";
import { MaterialRow } from "./student-materials-client";
import styles from "./student-materials.module.css";

type Props = { folders: StudentMaterialFolder[]; materials: StudentMaterialItem[]; initialFolderId: string | null; initialQuery: string };

export default function StudentMaterialsExplorer({ folders, materials, initialFolderId, initialQuery }: Props) {
  const folderIds = useMemo(() => new Set(folders.map((item) => item.id)), [folders]);
  const [folderId, setFolderId] = useState(folderIds.has(initialFolderId ?? "") ? initialFolderId : null);
  const [query, setQuery] = useState(initialQuery);
  const normalized = query.trim().toLocaleLowerCase("ru");
  const currentFolder = folderId ? folders.find((item) => item.id === folderId) ?? null : null;
  const breadcrumbs = currentFolder ? buildBreadcrumbs(currentFolder.id, folders) : [];
  const visibleFolders = normalized ? folders.filter((item) => item.name.toLocaleLowerCase("ru").includes(normalized)) : folders.filter((item) => item.parentId === folderId);
  const visibleMaterials = normalized ? materials.filter((item) => `${item.title} ${item.description ?? ""}`.toLocaleLowerCase("ru").includes(normalized)) : materials.filter((item) => item.folderId === folderId);
  const pinned = !folderId && !normalized ? materials.filter((item) => item.pinned) : [];

  useEffect(() => {
    const sync = () => {
      const match = window.location.pathname.match(/^\/student\/materials\/folders\/([^/]+)\/?$/);
      const nextId = match ? decodeURIComponent(match[1]) : null;
      setFolderId(nextId && folderIds.has(nextId) ? nextId : null);
      setQuery(new URLSearchParams(window.location.search).get("q") ?? "");
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [folderIds]);

  function navigate(nextFolderId: string | null) {
    const safeId = nextFolderId && folderIds.has(nextFolderId) ? nextFolderId : null;
    const url = new URL(safeId ? `/student/materials/folders/${safeId}` : "/student/materials", window.location.origin);
    if (query) url.searchParams.set("q", query);
    window.history.pushState(null, "", `${url.pathname}${url.search}`);
    setFolderId(safeId);
  }

  function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("q") ?? "");
    const url = new URL(window.location.href);
    if (value) url.searchParams.set("q", value);
    else url.searchParams.delete("q");
    window.history.pushState(null, "", `${url.pathname}${url.search}`);
    setQuery(value);
  }

  return <div className={styles.page}>
    {(currentFolder || breadcrumbs.length > 0) && <div className={styles.folderNavigation}>
      {currentFolder && <button type="button" className={styles.backButton} onClick={() => navigate(currentFolder.parentId)}>← Назад</button>}
      <nav className={styles.breadcrumbs} aria-label="Хлебные крошки"><button type="button" onClick={() => navigate(null)}>Материалы</button>{breadcrumbs.map((item, index) => <span key={item.id}>›{index === breadcrumbs.length - 1 ? <b>{item.name}</b> : <button type="button" onClick={() => navigate(item.id)}>{item.name}</button>}</span>)}</nav>
    </div>}
    {pinned.length > 0 && <section className={styles.pinned}><h2>Закреплённые</h2><div>{pinned.map((item) => <MaterialRow item={item} compact key={item.id}/>)}</div></section>}
    <form className={styles.search} onSubmit={search}><input name="q" defaultValue={query} key={`${folderId}:${query}`} placeholder="Поиск по материалам" aria-label="Поиск по материалам"/><button>Найти</button>{query && <button type="button" onClick={() => { const url = new URL(window.location.href); url.searchParams.delete("q"); window.history.pushState(null, "", `${url.pathname}${url.search}`); setQuery(""); }}>Сбросить</button>}</form>
    {!visibleFolders.length && !visibleMaterials.length ? <section className={styles.empty}><h2>{normalized ? "Ничего не найдено" : folderId ? "В этой папке пока нет материалов" : "Материалов пока нет"}</h2>{!normalized && !folderId && <p>Здесь появятся файлы и ссылки от преподавателя.</p>}</section> : <div className={styles.list}>
      {visibleFolders.map((folder) => <button type="button" className={styles.row} onClick={() => navigate(folder.id)} key={folder.id}><span className={styles.icon}>▰</span><span className={styles.info}><strong>{folder.name}</strong><small>Папка</small></span></button>)}
      {visibleMaterials.filter((item) => item.type === "FILE").map((item) => <MaterialRow item={item} key={item.id}/>)}
      {visibleMaterials.filter((item) => item.type === "LINK").map((item) => <MaterialRow item={item} key={item.id}/>)}
    </div>}
  </div>;
}

function buildBreadcrumbs(id: string, folders: StudentMaterialFolder[]) { const map = new Map(folders.map((item) => [item.id, item])); const result: StudentMaterialFolder[] = []; const seen = new Set<string>(); let current = map.get(id); while (current && !seen.has(current.id)) { seen.add(current.id); result.unshift(current); current = current.parentId ? map.get(current.parentId) : undefined; } return result; }
