"use client";

import { useEffect, useState } from "react";
import MaterialCard, { type MaterialItem } from "./material-card";
import styles from "@/app/admin/materials/materials.module.css";

export default function MaterialList({ materials }: { materials: MaterialItem[] }) {
  const [hiddenIds, setHiddenIds] = useState<string[]>([]), [notice, setNotice] = useState("");
  useEffect(() => { if (!notice) return; const timeout = window.setTimeout(() => setNotice(""), 5000); return () => window.clearTimeout(timeout); }, [notice]);
  return <><div className={styles.materialGrid}>{materials.filter((material) => !hiddenIds.includes(material.id)).map((material) => <MaterialCard material={material} key={material.id} onDeleted={(message) => { setHiddenIds((ids) => [...ids, material.id]); setNotice(message); }}/>)}</div>{notice && <div className={styles.deleteNotice} role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label="Закрыть уведомление">×</button></div>}</>;
}
