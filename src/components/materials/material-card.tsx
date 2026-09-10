"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { getMaterialFileUrl, type MaterialType } from "@/app/admin/materials/actions";
import MaterialDeleteButton from "./material-delete-button";
import styles from "./material-cards.module.css";

export type MaterialItem = { id: string; type: MaterialType; title: string; description: string | null; file_size: number | null; external_url: string | null; created_at: string; signedUrl: string | null };
const labels: Record<MaterialType, string> = { FILE: "Файл", LINK: "Ссылка", VIDEO: "Видео", TEXT: "Текст" };
const icons: Record<MaterialType, string> = { FILE: "F", LINK: "↗", VIDEO: "▶", TEXT: "T" };
function fileSize(value: number | null) { if (value === null) return null; if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} МБ`; if (value >= 1024) return `${Math.round(value / 1024)} КБ`; return `${value} Б`; }

export default function MaterialCard({ material, onDeleted }: { material: MaterialItem; onDeleted: (message: string) => void }) {
  const [fileError, setFileError] = useState("");
  const [opening, startOpening] = useTransition();
  const href = material.type === "TEXT" ? `/admin/materials/${material.id}` : material.external_url;
  const action = material.type === "LINK" ? "Открыть ссылку" : material.type === "VIDEO" ? "Смотреть видео" : "Открыть материал";
  const openFile = () => {
    const target = window.open("about:blank", "_blank");
    if (target) target.opener = null;
    startOpening(async () => {
      setFileError("");
      const result = await getMaterialFileUrl(material.id);
      if (!result.ok) { target?.close(); setFileError(result.message); return; }
      if (target) target.location.replace(result.url);
      else setFileError("Браузер заблокировал новое окно. Разрешите всплывающие окна и повторите попытку.");
    });
  };
  return <article className={`${styles.materialCard} ${styles[material.type.toLowerCase()]}`}><span className={styles.materialIcon}>{icons[material.type]}</span><div className={styles.materialCopy}><h3>{material.title}</h3>{material.description && <p>{material.description}</p>}<div className={styles.compactMeta}><span>{labels[material.type]}</span>{material.type === "FILE" && fileSize(material.file_size) && <span>{fileSize(material.file_size)}</span>}<time dateTime={material.created_at}>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(new Date(material.created_at))}</time></div>{fileError && <p className={styles.fileError} role="alert">{fileError}</p>}</div><div className={styles.materialActions}>{material.type === "FILE" ? <button type="button" onClick={openFile} disabled={opening}>{opening ? "Открываем…" : "Открыть файл"}</button> : href ? <Link href={href} target={material.type === "TEXT" ? undefined : "_blank"} rel={material.type === "TEXT" ? undefined : "noopener noreferrer"}>{action}</Link> : <span className={styles.unavailable}>Материал недоступен</span>}<MaterialDeleteButton materialId={material.id} title={material.title} onDeleted={onDeleted}/></div></article>;
}
