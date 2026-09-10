"use client";

import { useEffect, useState, useTransition } from "react";
import type { ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import BackLink from "@/components/back-link";
import MathText from "@/components/tests/math-text";
import type { TheoryQuestion, TheoryStatus } from "@/lib/trainers/theory-types";
import { publishTheoryTrainer, saveTheoryTrainer } from "../actions";
import styles from "./theory-editor.module.css";

type Editor = { id: string; title: string; status: TheoryStatus; definition: { questions: TheoryQuestion[] }; contentRevision: number; updatedAt: string };
const letters = ["A", "B", "C", "D"];
function newQuestion(): TheoryQuestion { return { key: `q_${crypto.randomUUID().replaceAll("-", "")}`, text: "", options: ["", "", "", ""], correctOption: 0, explanation: "", fingerprint: "" }; }

function QuestionCard({ question, index, change, remove, dragHandle }: { question: TheoryQuestion; index: number; change: (next: TheoryQuestion) => void; remove: () => void; dragHandle: ReactNode }) {
  return <article className={styles.question}><header>{dragHandle}<strong>Вопрос {index + 1}</strong><button className={styles.remove} type="button" onClick={remove}>Удалить вопрос</button></header><label>Текст вопроса<textarea value={question.text} onChange={(event) => change({ ...question, text: event.target.value })} rows={3}/></label><div className={styles.options}><span>Варианты ответа</span>{question.options.map((option, optionIndex) => <label key={letters[optionIndex]}><input type="radio" name={`correct-${question.key}`} checked={question.correctOption === optionIndex} onChange={() => change({ ...question, correctOption: optionIndex })}/><b>{letters[optionIndex]})</b><textarea value={option} onChange={(event) => { const options = [...question.options] as TheoryQuestion["options"]; options[optionIndex] = event.target.value; change({ ...question, options }); }} rows={2}/></label>)}</div><label className={styles.explanation}>Объяснение<textarea value={question.explanation} onChange={(event) => change({ ...question, explanation: event.target.value })} rows={4}/><small>Поддерживается математика: <MathText>$F=ma$</MathText></small></label></article>;
}
function SortableQuestion(props: Omit<Parameters<typeof QuestionCard>[0], "dragHandle">) { const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: props.question.key }); const dragHandle = <button className={styles.drag} type="button" {...attributes} {...listeners} aria-label={`Переместить вопрос ${props.index + 1}`}>⠿</button>; return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}><QuestionCard {...props} dragHandle={dragHandle}/></div>; }

export default function TheoryEditor({ initial }: { initial: Editor }) {
  const [editor, setEditor] = useState(initial); const [dirty, setDirty] = useState(false); const [mounted, setMounted] = useState(false); const [message, setMessage] = useState(""); const [pending, start] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration gate keeps dnd-kit accessibility ids deterministic
    setMounted(true);
  }, []);
  useEffect(() => { const warning = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); }; window.addEventListener("beforeunload", warning); return () => window.removeEventListener("beforeunload", warning); }, [dirty]);
  const change = (next: Editor) => { setEditor(next); setDirty(true); setMessage(""); };
  const setQuestion = (key: string, question: TheoryQuestion) => change({ ...editor, definition: { questions: editor.definition.questions.map((item) => item.key === key ? question : item) } });
  const remove = (question: TheoryQuestion) => { if ((question.text.trim() || question.options.some(Boolean) || question.explanation.trim()) && !confirm("Удалить заполненный вопрос?")) return; change({ ...editor, definition: { questions: editor.definition.questions.filter((item) => item.key !== question.key) } }); };
  const dragEnd = ({ active, over }: DragEndEvent) => { if (!over || active.id === over.id) return; const from = editor.definition.questions.findIndex((item) => item.key === active.id); const to = editor.definition.questions.findIndex((item) => item.key === over.id); change({ ...editor, definition: { questions: arrayMove(editor.definition.questions, from, to) } }); };
  const save = () => start(async () => { const result = await saveTheoryTrainer(editor.id, editor.contentRevision, editor.title, editor.definition.questions); setMessage(result.message); if (result.ok) { setEditor((current) => ({ ...current, definition: result.definition as Editor["definition"], contentRevision: result.contentRevision ?? current.contentRevision })); setDirty(false); } });
  const publish = () => { if (dirty) { setMessage("Сначала сохраните изменения."); return; } start(async () => { const result = await publishTheoryTrainer(editor.id); setMessage(result.message); if (result.ok) setEditor((current) => ({ ...current, status: "PUBLISHED" })); }); };
  const list = editor.definition.questions.map((question, index) => <div id={`question-${question.key}`} key={question.key}>{mounted ? <SortableQuestion question={question} index={index} change={(next) => setQuestion(question.key, next)} remove={() => remove(question)}/> : <QuestionCard question={question} index={index} change={(next) => setQuestion(question.key, next)} remove={() => remove(question)} dragHandle={<button className={styles.drag} type="button" disabled aria-label={`Перемещение вопроса ${index + 1} станет доступно после загрузки`}>⠿</button>}/>}</div>);
  return <div className={styles.editor}><BackLink href="/admin/trainers/theory">Назад к Theory</BackLink><header className={styles.header}><div><span>Theory</span><input value={editor.title} onChange={(event) => change({ ...editor, title: event.target.value })} maxLength={120} aria-label="Название Theory"/></div><aside><b className={editor.status === "PUBLISHED" ? styles.published : styles.draft}>{editor.status === "PUBLISHED" ? "Опубликован" : "Черновик"}</b><small>{dirty ? "Есть несохранённые изменения" : `Revision ${editor.contentRevision}`}</small><div><button onClick={save} disabled={pending || !dirty}>{pending ? "Сохраняем…" : "Сохранить"}</button>{editor.status === "DRAFT" && <button onClick={publish} disabled={pending || dirty}>Опубликовать</button>}</div></aside></header>{message && <p className={styles.message} role="status">{message}</p>}{mounted ? <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}><SortableContext items={editor.definition.questions.map((question) => question.key)} strategy={verticalListSortingStrategy}><section className={styles.questions}>{list}</section></SortableContext></DndContext> : <section className={styles.questions}>{list}</section>}<button className={styles.add} type="button" onClick={() => { const question = newQuestion(); change({ ...editor, definition: { questions: [...editor.definition.questions, question] } }); }}>+ Добавить вопрос</button></div>;
}
