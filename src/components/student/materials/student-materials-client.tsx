"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toggleStudentMaterialPin } from "@/app/student/materials/actions";
import type { StudentMaterialFolder, StudentMaterialItem } from "@/lib/materials/student-material-library";
import styles from "./student-materials.module.css";

export function MaterialRows({ folders, materials }: { folders: StudentMaterialFolder[]; materials: StudentMaterialItem[] }) {
  return <div className={styles.list}>
    {folders.map((folder) => <Link className={styles.row} href={`/student/materials/folders/${folder.id}`} key={folder.id}><span className={styles.icon}>▰</span><span className={styles.info}><strong>{folder.name}</strong><small>Папка</small></span><b aria-hidden>→</b></Link>)}
    {materials.filter((item) => item.type === "FILE").map((item) => <MaterialRow item={item} key={item.id}/>)}
    {materials.filter((item) => item.type === "LINK").map((item) => <MaterialRow item={item} key={item.id}/>)}
  </div>;
}

export function MaterialRow({ item, compact = false }: { item: StudentMaterialItem; compact?: boolean }) {
  const [pinned, setPinned] = useState(item.pinned);
  const [pending, startTransition] = useTransition();
  const meta = item.type === "FILE" ? [extension(item.originalFileName ?? item.title), item.fileSize ? formatSize(item.fileSize) : null].filter(Boolean).join(" · ") : safeDomain(item.externalUrl);
  return <div className={`${styles.row} ${compact ? styles.compact : ""}`}>
    <span className={styles.icon}>{item.type === "FILE" ? "▤" : "↗"}</span>
    <span className={styles.info}><strong>{item.title}</strong>{item.description && !compact && <span>{item.description}</span>}<small>{item.type === "FILE" ? `Файл${meta ? ` · ${meta}` : ""}` : `Ссылка${meta ? ` · ${meta}` : ""}`}</small></span>
    <button className={styles.pin} disabled={pending} aria-label={pinned ? "Открепить материал" : "Закрепить материал"} aria-pressed={pinned} onClick={() => { const next = !pinned; setPinned(next); startTransition(async () => { const result = await toggleStudentMaterialPin(item.id, next); if (!result.ok) setPinned(!next); }); }}>{pinned ? "◆" : "◇"}</button>
    <a className={styles.open} href={`/student/materials/open/${item.id}`} target="_blank" rel="noopener noreferrer">{item.type === "FILE" ? "Открыть" : "Перейти"}</a>
  </div>;
}

function extension(name: string) { const part = name.split(".").pop(); return part && part !== name ? part.toUpperCase() : ""; }
function formatSize(bytes: number) { if (bytes < 1024) return `${bytes} Б`; if (bytes < 1048576) return `${Math.round(bytes / 1024)} КБ`; return `${(bytes / 1048576).toFixed(1).replace(".", ",")} МБ`; }
function safeDomain(value: string | null) { try { return value ? new URL(value).hostname.replace(/^www\./, "") : ""; } catch { return ""; } }
