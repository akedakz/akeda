"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { deleteStudent } from "@/app/admin/students/[id]/student-profile-actions";
import styles from "./student-profile-panel.module.css";

export default function StudentDeleteButton({ studentId, studentName }: { studentId: string; studentName: string }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const openerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  function close() {
    if (pending) return;
    setOpen(false); setConfirmation(""); setError("");
    requestAnimationFrame(() => openerRef.current?.focus());
  }

  useEffect(() => {
    if (!open) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => cancelRef.current?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        setOpen(false); setConfirmation(""); setError("");
        requestAnimationFrame(() => openerRef.current?.focus());
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener("keydown", keydown); };
  }, [open, pending]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError("");
    startTransition(async () => {
      const result = await deleteStudent(studentId, formData);
      if (!result.ok) setError(result.message);
    });
  }

  return <>
    <button ref={openerRef} type="button" className={styles.deleteTrigger} onClick={() => setOpen(true)}>Удалить ученика</button>
    {open && <div className={styles.deleteBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><div ref={dialogRef} className={styles.deleteModal} role="dialog" aria-modal="true" aria-labelledby="delete-student-title">
      <h2 id="delete-student-title">Удалить ученика?</h2>
      <p>Удалить ученика “{studentName}”? Будут безвозвратно удалены его профиль, назначения тестов, попытки, ответы, результаты и доступы к материалам.</p>
      <form onSubmit={submit}><label><span>Введите DELETE для подтверждения</span><input name="confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" disabled={pending}/></label>{error && <p className={styles.formError} role="alert">{error}</p>}<div className={styles.deleteActions}><button ref={cancelRef} type="button" className={styles.cancelButton} onClick={close} disabled={pending}>Отмена</button><button type="submit" className={styles.confirmDelete} disabled={pending || confirmation !== "DELETE"}>{pending ? "Удаляем…" : "Удалить ученика"}</button></div></form>
    </div></div>}
  </>;
}
