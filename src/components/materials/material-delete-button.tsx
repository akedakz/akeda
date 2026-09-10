"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteMaterial } from "@/app/admin/materials/actions";
import styles from "./material-delete-button.module.css";

export default function MaterialDeleteButton({ materialId, title, redirectAfterDelete = false, onDeleted }: { materialId: string; title: string; redirectAfterDelete?: boolean; onDeleted?: (message: string) => void }) {
  const [open, setOpen] = useState(false), [error, setError] = useState(""), [pending, startTransition] = useTransition();
  const titleId = useId(), cancelRef = useRef<HTMLButtonElement>(null), router = useRouter();
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !pending) setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, pending]);

  const remove = () => startTransition(async () => {
    setError("");
    const result = await deleteMaterial(materialId);
    if (!result.ok) { setError(result.message); return; }
    setOpen(false);
    onDeleted?.(result.message);
    if (redirectAfterDelete) { router.push(result.redirectPath); router.refresh(); }
  });

  return <><button className={styles.deleteButton} type="button" onClick={() => { setError(""); setOpen(true); }}>Удалить</button>{open && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setOpen(false); }}><div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId}><h2 id={titleId}>Удалить материал «{title}»?</h2><p>Это действие нельзя отменить.</p>{error && <p className={styles.error} role="alert">{error}</p>}<div className={styles.actions}><button ref={cancelRef} type="button" onClick={() => setOpen(false)} disabled={pending}>Отмена</button><button className={styles.confirm} type="button" onClick={remove} disabled={pending}>{pending ? "Удаляем…" : "Удалить"}</button></div></div></div>}</>;
}
