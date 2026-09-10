"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import MathText from "@/components/tests/math-text";
import type { FormulaRecallFormula, FormulaRecallTopic } from "@/lib/formula-recall/types";
import { releasePending, tryAcquirePending } from "@/lib/ui/pending-guard";
import { createFormulaRecallTopic, deleteFormulaRecallFormula, deleteFormulaRecallTopic, moveFormulaRecallTopic, renameFormulaRecallTopic } from "./actions";
import styles from "./formula-recall.module.css";
import studentStyles from "@/app/student/trainers/trainers.module.css";

type DialogState = { kind: "create-topic" } | { kind: "rename-topic"; topic: FormulaRecallTopic } | { kind: "delete-topic"; topic: FormulaRecallTopic } | { kind: "delete-formula"; formula: FormulaRecallFormula } | null;

function Dialog({ title, close, pending, children }: { title: string; close: () => void; pending: boolean; children: React.ReactNode }) {
  return <div className={styles.backdrop} onPointerDown={(event) => { if (event.target === event.currentTarget && !pending) close(); }}><section className={styles.dialog} role="dialog" aria-modal="true" aria-label={title} aria-busy={pending} onKeyDown={(event) => { if (event.key !== "Escape") return; if (pending) { event.preventDefault(); event.stopPropagation(); } else close(); }}><header><h2>{title}</h2><button type="button" onClick={close} disabled={pending} aria-label="Закрыть">×</button></header>{children}</section></div>;
}

function TopicDialog({ state, close }: { state: Exclude<DialogState, { kind: "delete-formula" } | null>; close: () => void }) {
  const router = useRouter(); const [title, setTitle] = useState(state.kind === "create-topic" ? "" : state.topic.title); const [message, setMessage] = useState(""); const [pending, start] = useTransition(); const pendingGuard = useRef(false);
  const destructive = state.kind === "delete-topic";
  const safeClose = () => { if (!pendingGuard.current) close(); };
  const submit = () => { if (!tryAcquirePending(pendingGuard)) return; start(async () => {
    try { const result = state.kind === "create-topic" ? await createFormulaRecallTopic(title) : state.kind === "rename-topic" ? await renameFormulaRecallTopic(state.topic.id, title) : await deleteFormulaRecallTopic(state.topic.id); setMessage(result.message); if (result.ok) { close(); router.refresh(); } }
    catch { setMessage("Не удалось выполнить действие. Попробуйте ещё раз."); }
    finally { releasePending(pendingGuard); }
  }); };
  return <Dialog title={state.kind === "create-topic" ? "Новая тема" : state.kind === "rename-topic" ? "Переименовать тему" : "Удалить тему?"} close={safeClose} pending={pending}>
    {destructive ? <p>Удалить можно только пустую тему «{state.topic.title}».</p> : <label className={styles.field}>Название темы<input autoFocus value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="Например, Кинематика" /></label>}
    {message && <p className={styles.formMessage} role="status">{message}</p>}
    <footer><button type="button" className={styles.secondaryButton} disabled={pending} onClick={safeClose}>Отмена</button><button type="button" className={destructive ? styles.dangerButton : styles.primaryButton} disabled={pending || (!destructive && !title.trim())} onClick={submit}>{pending ? destructive ? "Удаляем…" : "Сохраняем…" : destructive ? "Удалить" : "Сохранить"}</button></footer>
  </Dialog>;
}

function FormulaDeleteDialog({ formula, close }: { formula: FormulaRecallFormula; close: () => void }) {
  const router = useRouter(); const [message, setMessage] = useState(""); const [pending, start] = useTransition(); const pendingGuard = useRef(false);
  const safeClose = () => { if (!pendingGuard.current) close(); };
  const remove = () => { if (!tryAcquirePending(pendingGuard)) return; start(async () => { try { const result = await deleteFormulaRecallFormula(formula.id); setMessage(result.message); if (result.ok) { close(); router.refresh(); } } catch { setMessage("Не удалось удалить формулу. Попробуйте ещё раз."); } finally { releasePending(pendingGuard); } }); };
  return <Dialog title="Удалить формулу?" close={safeClose} pending={pending}><p>Формула, её условия и альтернативные записи будут удалены.</p>{message && <p className={styles.formMessage} role="alert">{message}</p>}<footer><button className={styles.secondaryButton} disabled={pending} onClick={safeClose}>Отмена</button><button className={styles.dangerButton} disabled={pending} onClick={remove}>{pending ? "Удаляем…" : "Удалить"}</button></footer></Dialog>;
}

export default function FormulaRecallLibrary({ topics, formulas, loadError }: { topics: FormulaRecallTopic[]; formulas: FormulaRecallFormula[]; loadError: boolean }) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [moving, startMove] = useTransition();
  const router = useRouter();
  const moveTopic = (id: string, direction: -1 | 1) => startMove(async () => { const result = await moveFormulaRecallTopic(id, direction); if (result.ok) router.refresh(); });
  return <main className={styles.page}>
    <header className={`${studentStyles.quickProblemsPageHero} ${studentStyles.formulaRecallPageHero}`}><div className={studentStyles.quickProblemsHeroContent}><span>Тренажёры</span><h1>Formula Recall</h1><div className={styles.heroActions}><button className={styles.secondaryButton} onClick={() => setDialog({ kind: "create-topic" })}>Тема</button><Link className={styles.primaryButton} aria-disabled={!topics.length} href={topics.length ? "/admin/trainers/formula-recall/new" : "#topics-empty"}>Добавить формулу</Link></div></div></header>
    {loadError ? <section className={styles.error}>Не удалось загрузить Formula Recall. Примените migration библиотеки и обновите страницу.</section> : !topics.length ? <section className={styles.empty} id="topics-empty"><h2>Создайте первую тему</h2><p>После этого в неё можно будет добавить формулы.</p><button className={styles.primaryButton} onClick={() => setDialog({ kind: "create-topic" })}>Создать тему</button></section> : <section className={styles.topicList}>
      {topics.map((topic,index) => { const items = formulas.filter((formula) => formula.topicId === topic.id); return <details className={styles.topic} key={topic.id}><summary><div><span aria-hidden="true">⌄</span><h2>{topic.title}</h2><div className={styles.topicOrder} aria-label={`Порядок темы «${topic.title}»`}><button disabled={moving||index===0} aria-label={`Переместить тему «${topic.title}» вверх`} title="Переместить вверх" onClick={(event)=>{event.preventDefault();event.stopPropagation();moveTopic(topic.id,-1)}}>↑</button><button disabled={moving||index===topics.length-1} aria-label={`Переместить тему «${topic.title}» вниз`} title="Переместить вниз" onClick={(event)=>{event.preventDefault();event.stopPropagation();moveTopic(topic.id,1)}}>↓</button></div><small>{items.length} {items.length === 1 ? "формула" : items.length < 5 ? "формулы" : "формул"}</small></div><div className={styles.topicActions}><button onClick={(event) => { event.preventDefault(); event.stopPropagation(); setDialog({ kind: "rename-topic", topic }); }}>Переименовать</button><button className={styles.topicDelete} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setDialog({ kind: "delete-topic", topic }); }}>Удалить</button></div></summary><div className={styles.formulaGrid}>{items.length ? items.map((formula) => <article className={styles.formulaCard} key={formula.id}><div className={styles.renderedFormula}><MathText>{`$$${formula.canonicalExpression}$$`}</MathText></div><p><strong>{formula.conditions.length}</strong> {formula.conditions.length === 1 ? "условие" : formula.conditions.length < 5 ? "условия" : "условий"}{formula.alternatives.length ? <><span>·</span><strong>{formula.alternatives.length}</strong> {formula.alternatives.length === 1 ? "альтернатива" : "альтернативы"}</> : null}</p><footer><Link href={`/admin/trainers/formula-recall/${formula.id}/preview`}>Предпросмотр</Link><Link href={`/admin/trainers/formula-recall/${formula.id}/edit`}>Редактировать</Link><button aria-label="Удалить формулу" title="Удалить формулу" onClick={() => setDialog({ kind: "delete-formula", formula })}>⋯</button></footer></article>) : <div className={styles.topicEmpty}>В этой теме пока нет формул.</div>}</div></details>; })}
    </section>}
    {dialog?.kind === "delete-formula" ? <FormulaDeleteDialog formula={dialog.formula} close={() => setDialog(null)} /> : dialog ? <TopicDialog state={dialog} close={() => setDialog(null)} /> : null}
  </main>;
}
