"use client";

import { useRef, useState, type ChangeEvent, type ClipboardEvent, type CSSProperties, type ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { uploadQuestionImage } from "./actions";
import type { EditorOption, EditorQuestion, MultiPartPart, NumericMode, QuestionType } from "./types";
import styles from "./test-editor.module.css";
import QuestionImage from "@/components/tests/question-image";

const typeLabels: Record<QuestionType, string> = { SINGLE_CHOICE: "Один ответ", MULTIPLE_CHOICE: "Несколько ответов", NUMERIC: "Числовой", MATCHING: "Соответствие", MULTI_PART: "Задача с подпунктами" };
const acceptedImages = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function newOption(): EditorOption { return { id: null, clientId: crypto.randomUUID(), text: "", isCorrect: false, position: 0 }; }
function newPart(position: number): MultiPartPart { return { key: crypto.randomUUID(), label: String.fromCharCode(97 + position), prompt: "", type: "NUMERIC", points: 1, position, numericMode: "EXACT", numericAnswer: null, numericTolerance: null, numericMin: null, numericMax: null, options: [] }; }
function numberOrNull(value: string) { if (!value.trim()) return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function pointsWord(points: number) { const integer = Math.abs(Math.trunc(points)); const lastTwo = integer % 100; const last = integer % 10; return lastTwo >= 11 && lastTwo <= 14 ? "баллов" : last === 1 ? "балл" : last >= 2 && last <= 4 ? "балла" : "баллов"; }

export type QuestionEditorCardProps = { testId: string; question: EditorQuestion; index: number; errors: string[]; onActive: () => void; onChange: (question: EditorQuestion) => void; onDuplicate: () => void; onDelete: () => void };

export default function SortableQuestionEditorCard(props: QuestionEditorCardProps) {
  const { question, index } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: question.clientId });
  const dragHandle = <button className={styles.dragHandle} type="button" aria-label={`Переместить вопрос ${index + 1}`} {...attributes} {...listeners}><span /><span /><span /></button>;

  return <QuestionEditorCardContent {...props} setNodeRef={setNodeRef} containerStyle={{ transform: CSS.Transform.toString(transform), transition }} isDragging={isDragging} dragHandle={dragHandle} />;
}

export function StaticQuestionEditorCard(props: QuestionEditorCardProps) {
  const dragHandle = <button className={styles.dragHandle} type="button" aria-label={`Перемещение вопроса ${props.index + 1} станет доступно после загрузки`} disabled><span /><span /><span /></button>;
  return <QuestionEditorCardContent {...props} dragHandle={dragHandle} />;
}

function QuestionEditorCardContent({ testId, question, index, errors, onActive, onChange, onDuplicate, onDelete, setNodeRef, containerStyle, isDragging = false, dragHandle }: QuestionEditorCardProps & { setNodeRef?: (node: HTMLElement | null) => void; containerStyle?: CSSProperties; isDragging?: boolean; dragHandle: ReactNode }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState("");
  const [uploading, setUploading] = useState(false);
  const patch = (values: Partial<EditorQuestion>) => onChange({ ...question, ...values });

  const upload = async (file: File) => {
    setImageError("");
    if (!acceptedImages.has(file.type) || file.size > 10 * 1024 * 1024 || file.size === 0) { setImageError("Поддерживаются PNG, JPEG, WEBP и GIF до 10 МБ."); return; }
    setUploading(true);
    const formData = new FormData(); formData.set("file", file);
    const result = await uploadQuestionImage(testId, question.id ?? question.clientId, formData);
    setUploading(false);
    if (!result.ok) { setImageError(result.message); return; }
    patch({ imagePath: result.imagePath, imageUrl: result.imageUrl });
  };

  const handlePaste = (event: ClipboardEvent<HTMLElement>) => {
    const image = Array.from(event.clipboardData.items).find((item) => item.kind === "file" && item.type.startsWith("image/"));
    if (!image) return;
    event.preventDefault();
    const file = image.getAsFile();
    if (file) void upload(file);
  };

  const changeType = (nextType: QuestionType) => {
    if (nextType === question.type) return;
    const hasChoiceData = question.options.some((option) => option.text.trim() || option.isCorrect);
    const hasNumericData = question.numericAnswer !== null || question.numericTolerance !== null || question.numericMin !== null || question.numericMax !== null;
    if ((hasChoiceData || hasNumericData || question.typeConfig) && !window.confirm("При смене типа введённые ответы будут удалены. Продолжить?")) return;
    const isChoice = nextType === "SINGLE_CHOICE" || nextType === "MULTIPLE_CHOICE";
    const matching = { matching: { allowOptionReuse: false, leftItems: [0, 1].map((position) => ({ key: crypto.randomUUID(), label: String.fromCharCode(65 + position), text: "", position, correctOptionKey: null })), options: [0, 1].map((position) => ({ key: crypto.randomUUID(), label: String(position + 1), text: "", position })) } };
    patch({ type: nextType, options: isChoice ? [newOption(), newOption()].map((option, position) => ({ ...option, position })) : [], numericMode: nextType === "NUMERIC" ? "EXACT" : null, numericAnswer: null, numericTolerance: null, numericMin: null, numericMax: null, typeConfig: nextType === "MATCHING" ? matching : nextType === "MULTI_PART" ? { multiPart: { parts: [newPart(0)] } } : null, points: nextType === "MATCHING" ? 2 : 1 });
  };

  const setOption = (clientId: string, values: Partial<EditorOption>) => patch({ options: question.options.map((option) => option.clientId === clientId ? { ...option, ...values } : option) });
  const markCorrect = (clientId: string, checked: boolean) => patch({ options: question.options.map((option) => ({ ...option, isCorrect: question.type === "SINGLE_CHOICE" ? option.clientId === clientId && checked : option.clientId === clientId ? checked : option.isCorrect })) });
  const removeOption = (clientId: string) => { if (question.options.length <= 2) return; patch({ options: question.options.filter((option) => option.clientId !== clientId).map((option, position) => ({ ...option, position })) }); };

  return (
    <article ref={setNodeRef} className={`${styles.questionCard} ${isDragging ? styles.dragging : ""}`} style={containerStyle} onFocusCapture={onActive} onPointerDownCapture={onActive} onPaste={handlePaste}>
      <div className={styles.questionTop}>
        {dragHandle}
        <strong>Вопрос {index + 1}</strong>
        <label className={styles.typeSelect}><span className={styles.visuallyHidden}>Тип вопроса</span><select value={question.type} onChange={(event) => changeType(event.target.value as QuestionType)}>{Object.entries(typeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      </div>
      <div className={styles.questionBody}>
        <textarea className={styles.prompt} value={question.prompt} onChange={(event) => patch({ prompt: event.target.value })} placeholder="Введите текст вопроса" rows={3} />
        <input ref={fileRef} className={styles.visuallyHidden} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />
        {question.imageUrl ? (
          <div className={styles.imagePreview}>
            <QuestionImage src={question.imageUrl} />
            <div><button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}>Заменить</button><button type="button" onClick={() => patch({ imagePath: null, imageUrl: null })}>Удалить</button></div>
          </div>
        ) : question.imagePath ? (
          <div className={styles.imageUnavailable}><span>Превью изображения временно недоступно</span><button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}>Заменить</button><button type="button" onClick={() => patch({ imagePath: null, imageUrl: null })}>Удалить</button></div>
        ) : <button className={styles.imageButton} type="button" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? "Загрузка…" : "+ Добавить изображение"}</button>}
        {imageError && <p className={styles.inlineError} role="alert">{imageError}</p>}
        {(question.type === "SINGLE_CHOICE" || question.type === "MULTIPLE_CHOICE") && <div className={styles.options}><span className={styles.sectionLabel}>Варианты ответа</span>{question.options.map((option, optionIndex) => <div className={styles.optionRow} key={option.clientId}><input aria-label="Правильный ответ" type={question.type === "SINGLE_CHOICE" ? "radio" : "checkbox"} name={question.type === "SINGLE_CHOICE" ? `correct-${question.clientId}` : undefined} checked={option.isCorrect} onChange={(event) => markCorrect(option.clientId, event.target.checked)} /><input value={option.text} onChange={(event) => setOption(option.clientId, { text: event.target.value })} placeholder={`Вариант ${optionIndex + 1}`} /><button type="button" onClick={() => removeOption(option.clientId)} disabled={question.options.length <= 2} aria-label={`Удалить вариант ${optionIndex + 1}`}>×</button></div>)}<button className={styles.addOption} type="button" onClick={() => patch({ options: [...question.options, { ...newOption(), position: question.options.length }] })}>+ Добавить вариант</button></div>}
        {question.type === "NUMERIC" && <NumericFields question={question} patch={patch} />}
        {question.type === "MATCHING" && <MatchingFields question={question} patch={patch} />}
        {question.type === "MULTI_PART" && <MultiPartFields question={question} patch={patch} />}
        {errors.length > 0 && <ul className={styles.validationErrors}>{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
      </div>
      <footer className={styles.questionFooter}>
        <button type="button" onClick={onDuplicate}>Дублировать</button><button type="button" onClick={onDelete}>Удалить вопрос</button><span className={styles.footerDivider} />
        <label>Баллы <input type="number" min="0.1" step="0.1" value={question.points} disabled={question.type === "MATCHING" || question.type === "MULTI_PART"} onChange={(event) => patch({ points: Number(event.target.value) })} /></label>
        <label className={styles.switchLabel}>Обязательный <input type="checkbox" checked={question.isRequired} onChange={(event) => patch({ isRequired: event.target.checked })} /></label>
      </footer>
    </article>
  );
}

function MatchingFields({ question, patch }: { question: EditorQuestion; patch: (values: Partial<EditorQuestion>) => void }) {
  if (!question.typeConfig || !("matching" in question.typeConfig)) return null;
  const config = question.typeConfig.matching;
  const normalize = (next: typeof config) => ({ ...next, leftItems: next.leftItems.map((item, position) => ({ ...item, label: String.fromCharCode(65 + position), position })), options: next.options.map((option, position) => ({ ...option, label: String(position + 1), position })) });
  const commit = (next: typeof config) => { const matching = normalize(next); patch({ typeConfig: { matching }, points: matching.leftItems.length }); };
  const move = (kind: "leftItems" | "options", index: number, delta: number) => { const target = index + delta; if (target < 0 || target >= config[kind].length) return; const list = [...config[kind]]; [list[index], list[target]] = [list[target], list[index]]; commit({ ...config, [kind]: list }); };
  return <div className={styles.configBox}><label><input type="checkbox" checked={config.allowOptionReuse} onChange={(event) => commit({ ...config, allowOptionReuse: event.target.checked })} /> Разрешить повтор вариантов</label><h4>Левая часть</h4>{config.leftItems.map((item, index) => <div className={styles.configRow} key={item.key}><b>{item.label}.</b><input value={item.text} onChange={(event) => commit({ ...config, leftItems: config.leftItems.map((value) => value.key === item.key ? { ...value, text: event.target.value } : value) })} /><select value={item.correctOptionKey ?? ""} onChange={(event) => commit({ ...config, leftItems: config.leftItems.map((value) => value.key === item.key ? { ...value, correctOptionKey: event.target.value || null } : value) })}><option value="">Правильный вариант</option>{config.options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select><button type="button" onClick={() => move("leftItems", index, -1)}>↑</button><button type="button" onClick={() => move("leftItems", index, 1)}>↓</button><button type="button" disabled={config.leftItems.length <= 2} onClick={() => commit({ ...config, leftItems: config.leftItems.filter((value) => value.key !== item.key) })}>×</button></div>)}<button type="button" onClick={() => commit({ ...config, leftItems: [...config.leftItems, { key: crypto.randomUUID(), label: "", text: "", position: 0, correctOptionKey: null }] })}>+ Элемент</button><h4>Варианты</h4>{config.options.map((option, index) => <div className={styles.configRow} key={option.key}><b>{option.label}.</b><input value={option.text} onChange={(event) => commit({ ...config, options: config.options.map((value) => value.key === option.key ? { ...value, text: event.target.value } : value) })} /><button type="button" onClick={() => move("options", index, -1)}>↑</button><button type="button" onClick={() => move("options", index, 1)}>↓</button><button type="button" disabled={config.options.length <= 2} onClick={() => commit({ ...config, options: config.options.filter((value) => value.key !== option.key), leftItems: config.leftItems.map((value) => value.correctOptionKey === option.key ? { ...value, correctOptionKey: null } : value) })}>×</button></div>)}<button type="button" onClick={() => commit({ ...config, options: [...config.options, { key: crypto.randomUUID(), label: "", text: "", position: 0 }] })}>+ Вариант</button></div>;
}

function MultiPartFields({ question, patch }: { question: EditorQuestion; patch: (values: Partial<EditorQuestion>) => void }) {
  if (!question.typeConfig || !("multiPart" in question.typeConfig)) return null;
  const parts = question.typeConfig.multiPart.parts;
  const commit = (next: MultiPartPart[]) => { const normalized = next.map((part, position) => ({ ...part, label: String.fromCharCode(97 + position), position })); patch({ typeConfig: { multiPart: { parts: normalized } }, points: normalized.reduce((sum, part) => sum + part.points, 0) }); };
  const setPart = (key: string, values: Partial<MultiPartPart>) => commit(parts.map((part) => part.key === key ? { ...part, ...values } : part));
  const move = (index: number, delta: number) => { const target = index + delta; if (target < 0 || target >= parts.length) return; const next = [...parts]; [next[index], next[target]] = [next[target], next[index]]; commit(next); };
  return <div className={styles.configBox}>{parts.map((part, index) => <section className={styles.partCard} key={part.key}><div className={styles.configRow}><b>{part.label})</b><textarea value={part.prompt} onChange={(event) => setPart(part.key, { prompt: event.target.value })} /><select value={part.type} onChange={(event) => { const type = event.target.value as MultiPartPart["type"]; setPart(part.key, { type, options: type === "NUMERIC" ? [] : [newOption(), newOption()], numericMode: type === "NUMERIC" ? "EXACT" : null }); }}><option value="NUMERIC">Числовой</option><option value="SINGLE_CHOICE">Один ответ</option><option value="MULTIPLE_CHOICE">Несколько ответов</option></select><label className={styles.partPoints}><input aria-label="Баллы" type="number" min="0.1" step="0.1" value={part.points} onChange={(event) => setPart(part.key, { points: Number(event.target.value) })} /><span>{pointsWord(part.points)}</span></label><button type="button" onClick={() => move(index, -1)}>↑</button><button type="button" onClick={() => move(index, 1)}>↓</button><button type="button" disabled={parts.length <= 1} onClick={() => commit(parts.filter((value) => value.key !== part.key))}>×</button></div>{part.type === "NUMERIC" ? <PartNumeric part={part} setPart={setPart} /> : <PartOptions part={part} setPart={setPart} />}</section>)}<button type="button" onClick={() => commit([...parts, newPart(parts.length)])}>+ Добавить подпункт</button></div>;
}

function PartOptions({ part, setPart }: { part: MultiPartPart; setPart: (key: string, values: Partial<MultiPartPart>) => void }) { return <div>{part.options.map((option, index) => <div className={styles.optionRow} key={option.clientId}><input type={part.type === "SINGLE_CHOICE" ? "radio" : "checkbox"} name={part.type === "SINGLE_CHOICE" ? `part-${part.key}` : undefined} checked={option.isCorrect} onChange={(event) => setPart(part.key, { options: part.options.map((value) => ({ ...value, isCorrect: part.type === "SINGLE_CHOICE" ? value.clientId === option.clientId && event.target.checked : value.clientId === option.clientId ? event.target.checked : value.isCorrect })) })} /><input value={option.text} onChange={(event) => setPart(part.key, { options: part.options.map((value) => value.clientId === option.clientId ? { ...value, text: event.target.value } : value) })} placeholder={`Вариант ${index + 1}`} /><button type="button" disabled={part.options.length <= 2} onClick={() => setPart(part.key, { options: part.options.filter((value) => value.clientId !== option.clientId) })}>×</button></div>)}<button type="button" onClick={() => setPart(part.key, { options: [...part.options, newOption()] })}>+ Вариант</button></div>; }

function PartNumeric({ part, setPart }: { part: MultiPartPart; setPart: (key: string, values: Partial<MultiPartPart>) => void }) { const mode = part.numericMode ?? "EXACT"; const input = (key: "numericAnswer" | "numericTolerance" | "numericMin" | "numericMax", label: string) => <label className={styles.partNumericField}><span>{label}</span><input type="number" step="any" value={part[key] ?? ""} onChange={(event) => setPart(part.key, { [key]: numberOrNull(event.target.value) })} /></label>; return <div className={styles.numericGrid}><label className={styles.partNumericField}><span>Проверка</span><select value={mode} onChange={(event) => setPart(part.key, { numericMode: event.target.value as NumericMode, numericAnswer: null, numericTolerance: null, numericMin: null, numericMax: null })}><option value="EXACT">Точно</option><option value="TOLERANCE">Погрешность</option><option value="RANGE">Диапазон</option></select></label>{mode !== "RANGE" && input("numericAnswer", "Ответ")}{mode === "TOLERANCE" && input("numericTolerance", "Погрешность")}{mode === "RANGE" && <>{input("numericMin", "Минимум")}{input("numericMax", "Максимум")}</>}</div>; }

function NumericFields({ question, patch }: { question: EditorQuestion; patch: (values: Partial<EditorQuestion>) => void }) {
  const mode = question.numericMode ?? "EXACT";
  const numericInput = (label: string, value: number | null, key: "numericAnswer" | "numericTolerance" | "numericMin" | "numericMax") => <label className={styles.numericField}>{label}<input type="number" step="any" value={value ?? ""} onChange={(event) => patch({ [key]: numberOrNull(event.target.value) })} /></label>;
  return <div className={styles.numericBox}><label className={styles.numericMode}>Проверка ответа<select value={mode} onChange={(event) => patch({ numericMode: event.target.value as NumericMode, numericAnswer: null, numericTolerance: null, numericMin: null, numericMax: null })}><option value="EXACT">Точное значение</option><option value="TOLERANCE">С погрешностью</option><option value="RANGE">Диапазон</option></select></label><div className={styles.numericGrid}>{mode === "EXACT" && numericInput("Правильное значение", question.numericAnswer, "numericAnswer")}{mode === "TOLERANCE" && <>{numericInput("Правильное значение", question.numericAnswer, "numericAnswer")}{numericInput("Допустимая погрешность ±", question.numericTolerance, "numericTolerance")}</>}{mode === "RANGE" && <>{numericInput("Минимум", question.numericMin, "numericMin")}{numericInput("Максимум", question.numericMax, "numericMax")}</>}</div></div>;
}
