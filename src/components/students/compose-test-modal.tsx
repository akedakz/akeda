"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { createCompositeTestAssignment } from "@/app/admin/students/[id]/test-assignment-actions";
import { almatyLocalDateTimeToIso, defaultAlmatyDeadline } from "@/lib/datetime/almaty";
import { balancedQuestionAllocation } from "@/lib/tests/composite-sampling";
import { initialAssignmentState, type LibraryLevel, type LibraryTest } from "./test-assignment-types";
import styles from "./test-assignments.module.css";

type Props = { studentId: string; open: boolean; onClose: () => void; onSuccess: (message: string) => void; opener: React.RefObject<HTMLButtonElement | null> };

export default function ComposeTestModal({ studentId, open, onClose, onSuccess, opener }: Props) {
  const [level, setLevel] = useState<LibraryLevel | null>(null);
  const [selected, setSelected] = useState<Record<string, LibraryTest>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [title, setTitle] = useState("");
  const [titleEdited, setTitleEdited] = useState(false);
  const [questionCount, setQuestionCount] = useState(1);
  const [samplingMode, setSamplingMode] = useState<"POOL" | "BALANCED">("POOL");
  const [shuffle, setShuffle] = useState(true);
  const [withoutDeadline, setWithoutDeadline] = useState(true);
  const [deadline, setDeadline] = useState(defaultAlmatyDeadline);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(createCompositeTestAssignment.bind(null, studentId), initialAssignmentState);
  const selectedTests = useMemo(() => Object.values(selected), [selected]);
  const available = selectedTests.reduce((sum, test) => sum + test.questionCount, 0);
  const allocation = balancedQuestionAllocation(selectedTests.map((test) => ({ id: test.id, title: test.title, questionCount: test.questionCount })), questionCount);

  async function loadLevel(folderId: string | null) {
    setLoading(true); setLoadError("");
    try {
      const response = await fetch(`/api/admin/test-library?mode=compose${folderId ? `&folderId=${encodeURIComponent(folderId)}` : ""}`, { cache: "no-store" });
      const body = await response.json() as LibraryLevel & { message?: string };
      if (!response.ok) throw new Error(body.message || "Не удалось загрузить библиотеку тестов.");
      setLevel(body);
    } catch (error) { setLoadError(error instanceof Error ? error.message : "Не удалось загрузить библиотеку тестов."); }
    finally { setLoading(false); }
  }

  function close() { if (pending) return; onClose(); requestAnimationFrame(() => opener.current?.focus()); }
  function commitSelection(next: Record<string, LibraryTest>) {
    const tests = Object.values(next);
    const nextAvailable = tests.reduce((sum, test) => sum + test.questionCount, 0);
    setSelected(next);
    setQuestionCount((value) => nextAvailable ? Math.min(Math.max(1, value), nextAvailable) : 1);
    if (!titleEdited) setTitle(tests.length === 1 ? `Индивидуальный тест — ${tests[0].title}` : tests.length ? `Индивидуальный тест — ${tests.length} источника` : "");
  }
  function toggle(test: LibraryTest) {
    const next = { ...selected }; if (next[test.id]) delete next[test.id]; else next[test.id] = test; commitSelection(next);
  }
  function remove(id: string) { const next = { ...selected }; delete next[id]; commitSelection(next); }

  useEffect(() => { if (open) queueMicrotask(() => void loadLevel(null)); }, [open]);
  useEffect(() => {
    if (state.status !== "success") return;
    queueMicrotask(() => { onClose(); onSuccess(state.message); requestAnimationFrame(() => opener.current?.focus()); });
  }, [state, onClose, onSuccess, opener]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
    requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>("button, input")?.focus());
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape" && !pending) close(); };
    document.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", keydown); };
  });

  if (!open) return null;
  const invalidLimit = !Number.isInteger(questionCount) || questionCount < 1 || questionCount > available;
  const deadlineIso = !withoutDeadline && deadline ? almatyLocalDateTimeToIso(deadline) ?? "" : "";

  return <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className={`${styles.modal} ${styles.composeModal}`} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="compose-title">
      <header className={styles.modalHeader}><div><span>Индивидуальное назначение</span><h2 id="compose-title">Составить тест</h2></div><button type="button" className={styles.closeButton} onClick={close} disabled={pending} aria-label="Закрыть">×</button></header>
      <form action={action} className={styles.composeForm}>
        <input type="hidden" name="sourceTestIds" value={JSON.stringify(selectedTests.map((test) => test.id))}/>
        <input type="hidden" name="deadlineAt" value={deadlineIso}/>
        <input type="hidden" name="idempotencyKey" value={idempotencyKey}/>
        <section className={styles.composeBrowser}>
          <div className={styles.composeStats}><b>Выбрано тестов: {selectedTests.length}</b><b>Доступно вопросов: {available}</b></div>
          <nav className={styles.modalBreadcrumb} aria-label="Путь к папке"><button type="button" onClick={() => void loadLevel(null)}>Тесты</button>{level?.breadcrumb.map((item, index) => <span key={item.id}><span aria-hidden>›</span>{index === level.breadcrumb.length - 1 ? <b>{item.name}</b> : <button type="button" onClick={() => void loadLevel(item.id)}>{item.name}</button>}</span>)}</nav>
          {level?.breadcrumb.length ? <button className={styles.browserBack} type="button" onClick={() => void loadLevel(level.breadcrumb.at(-2)?.id ?? null)}>← Назад</button> : null}
          {loading && <p className={styles.browserState}>Загрузка…</p>}
          {loadError && <div className={styles.error}>{loadError}<button type="button" onClick={() => void loadLevel(level?.breadcrumb.at(-1)?.id ?? null)}>Повторить</button></div>}
          {!loading && !loadError && level && <>
            {!!level.folders.length && <div className={styles.folderGrid}>{level.folders.map((folder) => <button type="button" className={styles.folder} key={folder.id} onClick={() => void loadLevel(folder.id)}><span aria-hidden>▰</span><b>{folder.name}</b></button>)}</div>}
            <div className={styles.composeTestList}>{level.tests.map((test) => <label className={`${styles.composeTest} ${!test.questionCount ? styles.disabledTest : ""}`} key={test.id}><input type="checkbox" checked={Boolean(selected[test.id])} disabled={!test.questionCount} onChange={() => toggle(test)}/><span><b>{test.title}</b>{test.description && <small>{test.description}</small>}<em>{test.questionCount} вопр. · {test.maxPoints} баллов</em></span></label>)}</div>
          </>}
          <details className={styles.selectedTests} open={selectedTests.length > 0}><summary>Выбранные тесты ({selectedTests.length})</summary>{selectedTests.length ? <ul>{selectedTests.map((test) => <li key={test.id}><span>{test.title}</span><button type="button" onClick={() => remove(test.id)} aria-label={`Убрать ${test.title}`}>×</button></li>)}</ul> : <p>Тесты пока не выбраны.</p>}</details>
        </section>
        <section className={styles.composeSettings}>
          <h3>Параметры составления</h3>
          <label><span>Название нового теста</span><input type="text" name="title" value={title} onChange={(event) => { setTitleEdited(true); setTitle(event.target.value); }} required/></label>
          <label><span>Количество вопросов <small>из {available}</small></span><input type="number" name="questionCount" value={questionCount} min={1} max={Math.max(1, available)} onChange={(event) => setQuestionCount(Number(event.target.value))} required/></label>
          {invalidLimit && selectedTests.length > 0 && <p className={styles.formError}>Количество должно быть от 1 до {available}.</p>}
          <fieldset><legend>Способ выборки</legend><label><input type="radio" name="samplingMode" value="POOL" checked={samplingMode === "POOL"} onChange={() => setSamplingMode("POOL")}/><span><b>Случайно из общего пула</b><small>Случайный выбор из всех вопросов выбранных тестов.</small></span></label><label><input type="radio" name="samplingMode" value="BALANCED" checked={samplingMode === "BALANCED"} onChange={() => setSamplingMode("BALANCED")}/><span><b>Равномерно из каждого теста</b><small>Максимально равное количество с перераспределением нехватки.</small></span></label></fieldset>
          <label className={styles.check}><input type="checkbox" name="shuffleQuestions" checked={shuffle} onChange={(event) => setShuffle(event.target.checked)}/><span>Перемешать порядок вопросов</span></label>
          <label className={styles.check}><input type="checkbox" checked={withoutDeadline} onChange={(event) => setWithoutDeadline(event.target.checked)}/><span>Без дедлайна</span></label>
          {!withoutDeadline && <label><span>Дедлайн</span><input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} required/></label>}
          <label className={styles.check}><input type="checkbox" name="showCorrectAnswersAfterClose"/><span>Показывать правильные ответы после закрытия</span></label>
          <div className={styles.composeSummary}><h3>Предварительный итог</h3><dl><div><dt>Название</dt><dd>{title || "—"}</dd></div><div><dt>Исходных тестов</dt><dd>{selectedTests.length}</dd></div><div><dt>Вопросов</dt><dd>{invalidLimit ? "—" : questionCount} из {available}</dd></div><div><dt>Выборка</dt><dd>{samplingMode === "POOL" ? "Общий случайный пул" : "Равномерная"}</dd></div><div><dt>Перемешивание</dt><dd>{shuffle ? "Да" : "Нет"}</dd></div><div><dt>Срок</dt><dd>{withoutDeadline ? "Без дедлайна" : deadline || "—"}</dd></div></dl>{samplingMode === "BALANCED" && selectedTests.length > 0 && !invalidLimit && <div className={styles.allocation}><b>Ориентировочное распределение</b>{allocation.map((item) => <span key={item.id}>{item.title} — {item.count}</span>)}</div>}</div>
          {state.status === "error" && <p className={styles.formError} role="alert">{state.message}</p>}
        </section>
        <footer className={styles.composeActions}><button type="button" className={styles.secondary} onClick={close} disabled={pending}>Отмена</button><button type="submit" className={styles.primary} disabled={pending || !selectedTests.length || !title.trim() || invalidLimit}>{pending ? "Составляем…" : "Составить и назначить"}</button></footer>
      </form>
    </div>
  </div>;
}
