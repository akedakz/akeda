"use client";

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import styles from "./trainer-management.module.css";

export function TrainerSection({ title, count, icon, onAssign, children }: { title: string; count: string; icon: string; onAssign: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <section className={styles.section}>
    <header className={styles.sectionHeader}>
      <button className={styles.toggle} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span className={styles.icon} aria-hidden="true">{icon}</span><span className={styles.heading}><strong>{title}</strong><small>{count}</small></span><span className={styles.chevron} aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      <button className={styles.primary} onClick={onAssign}>Назначить</button>
    </header>
    <div id={id} hidden={!open} className={styles.content}>{children}</div>
  </section>;
}

export function ManagementModal({ title, pending, close, children, footer }: { title: string; pending: boolean; close: () => void; children: ReactNode; footer: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    dialog.showModal(); document.body.style.overflow = "hidden";
    return () => { dialog.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={ref} className={styles.modal} aria-labelledby={id} onCancel={(event) => { event.preventDefault(); if (!pending) close(); }} onClick={(event) => { if (event.target === event.currentTarget && !pending) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(); } }}>
    <header><h2 id={id}>{title}</h2><button className={styles.close} disabled={pending} onClick={close} aria-label="Закрыть">×</button></header>
    <div className={styles.modalBody}>{children}</div><footer className={styles.footer}>{footer}</footer>
  </dialog>;
}

export function SelectAll({ ids, selected, onChange, disabled = false }: { ids: string[]; selected: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const count = ids.filter((id) => selected.includes(id)).length;
  useEffect(() => { if (ref.current) ref.current.indeterminate = count > 0 && count < ids.length; }, [count, ids.length]);
  return <label className={styles.selectAll}><input ref={ref} type="checkbox" disabled={disabled || !ids.length} checked={ids.length > 0 && count === ids.length} onChange={() => onChange(count === ids.length ? selected.filter((id) => !ids.includes(id)) : [...new Set([...selected, ...ids])])}/>Выбрать все</label>;
}

export function useManagementMutation() {
  const router = useRouter();
  const busy = useRef(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const run = (action: () => Promise<{ ok: boolean; message: string }>, success?: () => void) => {
    if (busy.current) return;
    busy.current = true; setError(""); setNotice("");
    startTransition(async () => {
      try { const result = await action(); if (result.ok) { setNotice(result.message); success?.(); router.refresh(); } else setError(result.message); }
      catch { setError("Не удалось выполнить действие. Проверьте соединение и попробуйте ещё раз."); }
      finally { busy.current = false; }
    });
  };
  return { pending, error, notice, run, clear: () => { setError(""); setNotice(""); } };
}

export type AssignmentChoice = { id: string; content: ReactNode; disabledLabel?: string };
export function AssignmentModal({ title, groups, close, action }: { title: string; groups: { id: string; title: string; items: AssignmentChoice[] }[]; close: () => void; action: (ids: string[]) => Promise<{ ok: boolean; message: string }> }) {
  const [selected, setSelected] = useState<string[]>([]);
  const mutation = useManagementMutation();
  const available = groups.flatMap((group) => group.items.filter((item) => !item.disabledLabel).map((item) => item.id));
  const effective = selected.filter((id) => available.includes(id));
  return <ManagementModal title={title} pending={mutation.pending} close={close} footer={<><span>Выбрано: {effective.length}</span><button className={styles.secondary} disabled={mutation.pending} onClick={close}>Отмена</button><button className={styles.primary} disabled={mutation.pending || !effective.length || effective.length > 500} onClick={() => mutation.run(() => action(effective), close)}>{mutation.pending ? "Назначаем…" : `Назначить ${effective.length}`}</button></>}>
    <p className={styles.secondaryText}>Выберите элементы для назначения ученику.</p>
    <SelectAll ids={available} selected={effective} onChange={setSelected} disabled={mutation.pending}/>
    {effective.length > 500 && <p role="alert" className={styles.error}>За один раз можно назначить до 500 элементов.</p>}
    {!groups.length && <p className={styles.empty}>Нет доступных элементов.</p>}
    {groups.map((group) => <section className={styles.group} key={group.id}><h3>{group.title}</h3>{group.items.map((item) => <label className={`${styles.choice} ${item.disabledLabel ? styles.disabled : ""}`} key={item.id}>
      <input type="checkbox" disabled={mutation.pending || Boolean(item.disabledLabel)} checked={Boolean(item.disabledLabel) || effective.includes(item.id)} onChange={() => setSelected((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])}/><span className={styles.choiceCopy}>{item.content}{item.disabledLabel && <small>{item.disabledLabel}</small>}</span>
    </label>)}</section>)}
    {mutation.error && <p role="alert" className={styles.error}>{mutation.error}</p>}
  </ManagementModal>;
}
