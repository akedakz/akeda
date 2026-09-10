"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { deleteTest } from "@/app/admin/tests/[id]/actions";
import styles from "./test-delete-button.module.css";

export default function TestDeleteButton({ testId, testTitle, compact = false }: { testId: string; testTitle: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const titleId = useId(); const descriptionId = useId();
  const openerRef = useRef<HTMLButtonElement>(null); const inputRef = useRef<HTMLInputElement>(null); const dialogRef = useRef<HTMLDivElement>(null); const submittingRef = useRef(false);
  function close() { if (pending) return; setOpen(false); setConfirmation(""); setError(""); submittingRef.current = false; requestAnimationFrame(() => openerRef.current?.focus()); }
  useEffect(() => {
    if (!open) return;
    const oldOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; requestAnimationFrame(() => inputRef.current?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) { setOpen(false); setConfirmation(""); setError(""); submittingRef.current = false; requestAnimationFrame(() => openerRef.current?.focus()); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return; const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown); return () => { document.body.style.overflow = oldOverflow; document.removeEventListener("keydown", keydown); };
  }, [open, pending]);
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending || submittingRef.current || confirmation !== "DELETE") return; submittingRef.current = true; setError("");
    startTransition(async () => { const result = await deleteTest(testId, confirmation); if (!result.ok) { submittingRef.current = false; setError(result.message); } });
  }
  return <>
    <button ref={openerRef} type="button" className={compact ? styles.compactTrigger : styles.deleteTrigger} onClick={() => setOpen(true)}>Удалить{compact ? "" : " тест"}</button>
    {open && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><div ref={dialogRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
      <h2 id={titleId}>Удалить тест?</h2><div id={descriptionId}><p>Тест «{testTitle}» будет удалён из библиотеки без возможности восстановления.</p><p>Назначения и результаты учеников сохранятся.</p></div>
      <form onSubmit={submit} aria-busy={pending}><label><span>Введите DELETE для подтверждения</span><input ref={inputRef} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" disabled={pending} /></label>{error && <p className={styles.error} role="alert">{error}</p>}<div className={styles.actions}><button type="button" className={styles.cancel} onClick={close} disabled={pending}>Отмена</button><button type="submit" className={styles.confirm} disabled={pending || confirmation !== "DELETE"}>{pending ? "Удаляем…" : "Удалить тест"}</button></div></form>
    </div></div>}
  </>;
}
