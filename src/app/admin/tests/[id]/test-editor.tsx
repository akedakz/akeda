"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import BackLink from "@/components/back-link";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { saveTestEditor } from "./actions";
import { testPreviewHref } from "@/lib/tests/preview-return";
import SortableQuestionEditorCard, { StaticQuestionEditorCard } from "./question-editor-card";
import TestDeleteButton from "@/components/tests/test-delete-button";
import type { EditorOption, EditorQuestion, EditorTest, EditorValidationErrors } from "./types";
import styles from "./test-editor.module.css";

function option(position: number): EditorOption { return { id: null, clientId: crypto.randomUUID(), text: "", isCorrect: false, position }; }
function emptyQuestion(position: number): EditorQuestion { return { id: null, clientId: crypto.randomUUID(), type: "SINGLE_CHOICE", prompt: "", imagePath: null, imageUrl: null, points: 1, isRequired: true, position, numericMode: null, numericAnswer: null, numericTolerance: null, numericMin: null, numericMax: null, options: [option(0), option(1)], typeConfig: null }; }

function validate(editor: EditorTest): EditorValidationErrors {
  const errors: EditorValidationErrors = { questions: {} };
  if (!editor.title.trim()) errors.title = "Введите название теста.";
  editor.questions.forEach((question, index) => {
    const list: string[] = [];
    if (!question.prompt.trim() && !question.imagePath) list.push("Добавьте текст вопроса или изображение.");
    if (!Number.isFinite(question.points) || question.points <= 0) list.push("Баллы должны быть положительным числом.");
    if (question.type === "SINGLE_CHOICE" || question.type === "MULTIPLE_CHOICE") {
      const filled = question.options.filter((item) => item.text.trim());
      if (filled.length < 2) list.push("Нужны минимум два заполненных варианта.");
      const correct = filled.filter((item) => item.isCorrect).length;
      if (question.type === "SINGLE_CHOICE" && correct !== 1) list.push("Выберите ровно один правильный вариант.");
      if (question.type === "MULTIPLE_CHOICE" && correct < 1) list.push("Выберите хотя бы один правильный вариант.");
    }
    if (question.type === "NUMERIC") {
      if ((question.numericMode === "EXACT" || question.numericMode === "TOLERANCE") && !Number.isFinite(question.numericAnswer)) list.push("Укажите правильное числовое значение.");
      if (question.numericMode === "TOLERANCE" && (!Number.isFinite(question.numericTolerance) || (question.numericTolerance ?? -1) < 0)) list.push("Укажите неотрицательную погрешность.");
      if (question.numericMode === "RANGE" && (!Number.isFinite(question.numericMin) || !Number.isFinite(question.numericMax) || (question.numericMin ?? 0) > (question.numericMax ?? 0))) list.push("Проверьте границы диапазона.");
    }
    if (question.type === "MATCHING") {
      const config = question.typeConfig && "matching" in question.typeConfig ? question.typeConfig.matching : null;
      if (!config || config.leftItems.length < 2 || config.options.length < 2) list.push("Добавьте минимум две строки и два варианта соответствия.");
      else {
        if (config.leftItems.some((item) => !item.text.trim() || !item.correctOptionKey || !config.options.some((option) => option.key === item.correctOptionKey))) list.push("Заполните строки и выберите правильное соответствие для каждой.");
        if (config.options.some((item) => !item.text.trim())) list.push("Заполните все варианты соответствия.");
        const answers = config.leftItems.map((item) => item.correctOptionKey);
        if (!config.allowOptionReuse && new Set(answers).size !== answers.length) list.push("Правильные варианты не должны повторяться.");
      }
    }
    if (question.type === "MULTI_PART") {
      const config = question.typeConfig && "multiPart" in question.typeConfig ? question.typeConfig.multiPart : null;
      if (!config?.parts.length) list.push("Добавьте хотя бы один подпункт.");
      else config.parts.forEach((part) => {
        if (!part.prompt.trim()) list.push(`Подпункт ${part.label}: добавьте условие.`);
        if (!Number.isFinite(part.points) || part.points <= 0) list.push(`Подпункт ${part.label}: укажите положительные баллы.`);
        if (part.type === "NUMERIC" && ((part.numericMode === "EXACT" || part.numericMode === "TOLERANCE") && !Number.isFinite(part.numericAnswer) || part.numericMode === "TOLERANCE" && (!Number.isFinite(part.numericTolerance) || (part.numericTolerance ?? -1) < 0) || part.numericMode === "RANGE" && (!Number.isFinite(part.numericMin) || !Number.isFinite(part.numericMax) || (part.numericMin ?? 0) > (part.numericMax ?? 0)))) list.push(`Подпункт ${part.label}: проверьте числовой ответ.`);
        if (part.type !== "NUMERIC") { const filled = part.options.filter((item) => item.text.trim()); const correct = filled.filter((item) => item.isCorrect).length; if (filled.length < 2 || part.type === "SINGLE_CHOICE" && correct !== 1 || part.type === "MULTIPLE_CHOICE" && correct < 1) list.push(`Подпункт ${part.label}: проверьте варианты ответа.`); }
      });
    }
    if (list.length) errors.questions[question.clientId] = list.map((message) => `Вопрос ${index + 1}: ${message}`);
  });
  return errors;
}

function hasErrors(errors: EditorValidationErrors) { return Boolean(errors.title || Object.keys(errors.questions).length); }
function hasContent(question: EditorQuestion) { return Boolean(question.prompt.trim() || question.imagePath || question.options.some((item) => item.text.trim() || item.isCorrect) || question.numericAnswer !== null || question.numericMin !== null || question.numericMax !== null); }

export default function TestEditor({ initialTest, backHref }: { initialTest: EditorTest; backHref: string }) {
  const [isMounted, setIsMounted] = useState(false);
  const [editor, setEditor] = useState(initialTest);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<EditorValidationErrors>({ questions: {} });
  const [message, setMessage] = useState("");
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const maxPoints = useMemo(() => editor.questions.reduce((sum, question) => sum + (Number.isFinite(question.points) ? question.points : 0), 0), [editor.questions]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional hydration gate for dnd-kit generated accessibility IDs
    setIsMounted(true);
  }, []);

  useEffect(() => {
    const warning = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warning);
    return () => window.removeEventListener("beforeunload", warning);
  }, [dirty]);

  const change = (next: EditorTest) => { setEditor(next); setDirty(true); setMessage(""); };
  const updateQuestion = (clientId: string, question: EditorQuestion) => change({ ...editor, questions: editor.questions.map((item) => item.clientId === clientId ? question : item) });
  const addQuestion = () => {
    const question = emptyQuestion(editor.questions.length);
    change({ ...editor, questions: [...editor.questions, question] });
    window.setTimeout(() => document.getElementById(`question-${question.clientId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  };
  const duplicateQuestion = (source: EditorQuestion) => {
    const copy: EditorQuestion = { ...structuredClone(source), id: null, clientId: crypto.randomUUID(), position: source.position + 1, options: source.options.map((item, position) => ({ ...item, id: null, clientId: crypto.randomUUID(), position })) };
    const questions = [...editor.questions]; questions.splice(source.position + 1, 0, copy);
    change({ ...editor, questions: questions.map((item, position) => ({ ...item, position })) });
  };
  const deleteQuestion = (question: EditorQuestion) => {
    if (hasContent(question) && !window.confirm("Удалить заполненный вопрос? Это действие применится после сохранения.")) return;
    change({ ...editor, questions: editor.questions.filter((item) => item.clientId !== question.clientId).map((item, position) => ({ ...item, position })) });
  };
  const dragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = editor.questions.findIndex((item) => item.clientId === active.id);
    const to = editor.questions.findIndex((item) => item.clientId === over.id);
    change({ ...editor, questions: arrayMove(editor.questions, from, to).map((item, position) => ({ ...item, position })) });
  };
  const save = () => {
    const validation = validate(editor); setErrors(validation);
    if (hasErrors(validation)) { setMessage("Исправьте отмеченные ошибки перед сохранением."); return; }
    startTransition(async () => {
      const imageUrls = new Map(editor.questions.map((question) => [question.imagePath, question.imageUrl]));
      const result = await saveTestEditor(editor.id, editor);
      if (!result.ok) { setMessage(result.message); return; }
      const normalized = { ...result.test, questions: result.test.questions.map((question) => ({ ...question, imageUrl: imageUrls.get(question.imagePath) ?? null })) };
      setEditor(normalized); setDirty(false); setErrors({ questions: {} }); setMessage("Тест сохранён.");
    });
  };
  return (
    <div className={styles.editor} data-active-question={activeQuestionId ?? undefined}>
      <div className={styles.backLink}><BackLink href={backHref}>Назад к библиотеке</BackLink></div>
      <section className={styles.testHeader}>
        <div className={styles.titleFields}><input className={errors.title ? styles.invalid : ""} value={editor.title} onChange={(event) => change({ ...editor, title: event.target.value })} aria-label="Название теста" placeholder="Название теста" /><textarea value={editor.description} onChange={(event) => change({ ...editor, description: event.target.value })} aria-label="Описание теста" placeholder="Короткое описание" rows={2} />{errors.title && <small className={styles.inlineError}>{errors.title}</small>}</div>
        <div className={styles.summary}><span><strong>{editor.questions.length}</strong> вопросов</span><span><strong>{maxPoints}</strong> макс. баллов</span><span className={dirty ? styles.dirty : styles.saved}>{dirty ? "Есть несохранённые изменения" : editor.status === "PUBLISHED" ? "Опубликован" : "Черновик сохранён"}</span><div className={styles.editorActions}><button type="button" onClick={save} disabled={pending || !dirty}>{pending ? "Сохраняем…" : "Сохранить"}</button>{dirty ? <button className={styles.previewDisabled} type="button" disabled title="Сначала сохраните изменения">Предпросмотр</button> : <a className={styles.previewButton} href={testPreviewHref(editor.id, `/admin/tests/${editor.id}`)} target="_blank" rel="noreferrer">Предпросмотр</a>}</div>{dirty && <small className={styles.previewHint}>Сначала сохраните изменения</small>}</div>
      </section>
      {message && <p className={message === "Тест сохранён." ? styles.globalSuccess : styles.globalError} role="status">{message}</p>}
      {isMounted ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
          <SortableContext items={editor.questions.map((question) => question.clientId)} strategy={verticalListSortingStrategy}>
            <div className={styles.questionList}>{editor.questions.map((question, index) => <div id={`question-${question.clientId}`} key={question.clientId}><SortableQuestionEditorCard testId={editor.id} question={question} index={index} errors={errors.questions[question.clientId] ?? []} onActive={() => setActiveQuestionId(question.clientId)} onChange={(next) => updateQuestion(question.clientId, next)} onDuplicate={() => duplicateQuestion(question)} onDelete={() => deleteQuestion(question)} /></div>)}</div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className={styles.questionList}>{editor.questions.map((question, index) => <div id={`question-${question.clientId}`} key={question.clientId}><StaticQuestionEditorCard testId={editor.id} question={question} index={index} errors={errors.questions[question.clientId] ?? []} onActive={() => setActiveQuestionId(question.clientId)} onChange={(next) => updateQuestion(question.clientId, next)} onDuplicate={() => duplicateQuestion(question)} onDelete={() => deleteQuestion(question)} /></div>)}</div>
      )}
      <button className={styles.addQuestion} type="button" onClick={addQuestion}>+ Добавить вопрос</button>
      <section className={styles.dangerZone} aria-label="Удаление теста">
        <div><h2>Удалить тест</h2></div>
        <TestDeleteButton testId={editor.id} testTitle={editor.title} />
      </section>
    </div>
  );
}
