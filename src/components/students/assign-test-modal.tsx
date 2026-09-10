"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { createTestAssignment } from "@/app/admin/students/[id]/test-assignment-actions";
import { almatyLocalDateTimeToIso, applicationTimeZone, defaultAlmatyDeadline } from "@/lib/datetime/almaty";
import { testPreviewHref } from "@/lib/tests/preview-return";
import { initialAssignmentState, type LibraryLevel, type LibraryTest } from "./test-assignment-types";
import styles from "./test-assignments.module.css";

type Props = { studentId: string; activeSourceTestIds: string[]; open: boolean; onClose: () => void; onSuccess: (message: string) => void; opener: React.RefObject<HTMLButtonElement | null> };

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: applicationTimeZone, day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

export default function AssignTestModal({ studentId, activeSourceTestIds, open, onClose, onSuccess, opener }: Props) {
  const [level, setLevel] = useState<LibraryLevel | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<LibraryTest | null>(null);
  const [title, setTitle] = useState("");
  const [withoutDeadline, setWithoutDeadline] = useState(true);
  const [deadline, setDeadline] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(createTestAssignment.bind(null, studentId), initialAssignmentState);

  async function loadLevel(folderId: string | null) {
    setLoading(true);
    setLoadError("");
    try {
      const query = folderId ? `?folderId=${encodeURIComponent(folderId)}` : "";
      const response = await fetch(`/api/admin/test-library${query}`, { cache: "no-store" });
      const body = await response.json() as LibraryLevel & { message?: string };
      if (!response.ok) throw new Error(body.message || "Не удалось загрузить библиотеку тестов.");
      setLevel(body);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Не удалось загрузить библиотеку тестов.");
    } finally { setLoading(false); }
  }

  function close() {
    if (pending) return;
    onClose();
    requestAnimationFrame(() => opener.current?.focus());
  }

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => void loadLevel(null));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>("button, a, input")?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        onClose();
        requestAnimationFrame(() => opener.current?.focus());
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKeyDown); };
    // pending deliberately updates the Escape guard while the dialog is open.
  }, [open, pending, onClose, opener]);

  useEffect(() => {
    if (state.status !== "success") return;
    queueMicrotask(() => {
      onClose(); onSuccess(state.message);
      requestAnimationFrame(() => opener.current?.focus());
    });
  }, [state, onClose, onSuccess, opener]);

  if (!open) return null;
  const deadlineIso = !withoutDeadline && deadline ? almatyLocalDateTimeToIso(deadline) ?? "" : "";
  const availableTests = level?.tests.filter((test) => !activeSourceTestIds.includes(test.id)) ?? [];

  return <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className={styles.modal} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="assign-modal-title">
      <header className={styles.modalHeader}><div><span>Назначение теста</span><h2 id="assign-modal-title">{selected ? "Настройки назначения" : "Выберите тест"}</h2></div><button type="button" className={styles.closeButton} onClick={close} disabled={pending} aria-label="Закрыть">×</button></header>
      {!selected ? <div className={styles.browser}>
        <nav className={styles.modalBreadcrumb} aria-label="Путь к папке">
          <button type="button" onClick={() => void loadLevel(null)}>Тесты</button>
          {level?.breadcrumb.map((item, index) => <span key={item.id}><span aria-hidden>›</span>{index === level.breadcrumb.length - 1 ? <b>{item.name}</b> : <button type="button" onClick={() => void loadLevel(item.id)}>{item.name}</button>}</span>)}
        </nav>
        {loading && <p className={styles.browserState}>Загрузка…</p>}
        {loadError && <div className={styles.error}>{loadError}<button type="button" onClick={() => void loadLevel(level?.breadcrumb.at(-1)?.id ?? null)}>Повторить</button></div>}
        {!loading && !loadError && level && <>
          {!!level.folders.length && <section><h3>Папки</h3><div className={styles.folderGrid}>{level.folders.map((folder) => <button type="button" className={styles.folder} key={folder.id} onClick={() => void loadLevel(folder.id)}><span aria-hidden>▰</span><b>{folder.name}</b></button>)}</div></section>}
          {!!availableTests.length && <section><h3>Тесты</h3><div className={styles.testList}>{availableTests.map((test) => <article className={styles.libraryTest} key={test.id}><span className={styles.testIcon} aria-hidden>Т</span><div><h4>{test.title}</h4>{test.description && <p>{test.description}</p>}<small>{test.questionCount} вопр. · {formatDate(test.created_at)}</small></div><div className={styles.libraryActions}><button type="button" onClick={() => { setSelected(test); setTitle(test.title); setDeadline(defaultAlmatyDeadline()); setWithoutDeadline(true); }}>Выбрать</button><Link href={testPreviewHref(test.id, level.breadcrumb.length ? `/admin/tests/folders/${level.breadcrumb.at(-1)?.id}` : "/admin/tests")} target="_blank" rel="noopener noreferrer">Предпросмотр</Link></div></article>)}</div></section>}
          {!level.folders.length && !availableTests.length && <p className={styles.browserState}>Нет доступных для назначения тестов.</p>}
        </>}
      </div> : <form action={action} className={styles.settingsForm}>
        <input type="hidden" name="testId" value={selected.id}/><input type="hidden" name="deadlineAt" value={deadlineIso}/><input type="hidden" name="idempotencyKey" value={idempotencyKey}/>
        <label><span>Название теста</span><input name="title" value={title} onChange={(event) => setTitle(event.target.value)} required autoFocus/></label>
        <label className={styles.check}><input type="checkbox" checked={withoutDeadline} onChange={(event) => setWithoutDeadline(event.target.checked)}/><span>Без дедлайна</span></label>
        {!withoutDeadline && <label><span>Дедлайн</span><input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} required/></label>}
        <label className={styles.check}><input type="checkbox" name="showCorrectAnswersAfterClose"/><span>Показывать правильные ответы после закрытия</span></label>
        <p className={styles.help}>Ученик увидит правильные ответы только после дедлайна. Для теста без дедлайна — после завершения.</p>
        {state.status === "error" && <p className={styles.formError} role="alert">{state.message}</p>}
        <footer className={styles.modalActions}><button type="button" className={styles.secondary} onClick={() => setSelected(null)} disabled={pending}>Назад</button><button type="submit" className={styles.primary} disabled={pending || !title.trim()}>{pending ? "Назначаем…" : "Назначить тест"}</button></footer>
      </form>}
    </div>
  </div>;
}
