"use client";

import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useState, useTransition } from "react";
import { addStudentTopic, applyTopicTemplate, createTemplateFromStudent, deleteStudentTopic, renameStudentTopic, reorderStudentTopics, toggleStudentTopic } from "@/app/admin/students/[id]/topic-actions";
import { topicStatuses, topicStatusLabels } from "@/lib/topics/topic-status";
import LessonActionsDropdown from "./lesson-actions-dropdown";
import type { StudentTopic, TopicActionResult, TopicStatus, TopicTemplateSummary } from "./student-topic-types";
import styles from "./student-topics-panel.module.css";

type Modal = { kind: "add" } | { kind: "rename" | "delete" | "toggle"; topic: StudentTopic } | { kind: "snapshot" | "picker" } | { kind: "apply"; template: TopicTemplateSummary } | null;

export default function StudentTopicsPanel({ studentId, initialTopics }: { studentId: string; initialTopics: StudentTopic[] }) {
  const [topics, setTopics] = useState(initialTopics);
  const [mounted, setMounted] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [templates, setTemplates] = useState<TopicTemplateSummary[]>([]);
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState("replace");
  const [pending, startTransition] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const statuses = useMemo(() => topicStatuses(topics), [topics]);
  const completed = topics.filter((topic) => topic.completedAt).length;
  const current = topics.find((topic) => !topic.completedAt);

  useEffect(() => setMounted(true), []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 4000); return () => clearTimeout(timer); }, [notice]);

  function run(task: () => Promise<TopicActionResult>) {
    if (pending) return;
    setError("");
    startTransition(async () => {
      const result = await task();
      if (!result.ok) { setError(result.message); return; }
      if (result.topics) setTopics(result.topics);
      setModal(null);
      setNotice(result.message);
    });
  }

  function formAction(event: React.FormEvent<HTMLFormElement>, task: (data: FormData) => Promise<TopicActionResult>) {
    event.preventDefault();
    run(() => task(new FormData(event.currentTarget)));
  }

  async function openPicker() {
    setModal({ kind: "picker" }); setError("");
    const response = await fetch("/api/admin/topic-templates", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) setError(body.message); else setTemplates(body.templates);
  }

  function dragEnd({ active, over }: DragEndEvent) {
    if (pending || !over || active.id === over.id) return;
    const previous = topics;
    const next = arrayMove(topics, topics.findIndex((topic) => topic.id === active.id), topics.findIndex((topic) => topic.id === over.id));
    const boundaryValid = !next.some((topic, index) => !topic.completedAt && next.slice(index + 1).some((later) => later.completedAt));
    if (!boundaryValid) { setError("Перемещать тему между завершёнными и незавершёнными нельзя."); return; }
    setError(""); setTopics(next);
    startTransition(async () => {
      const result = await reorderStudentTopics(studentId, next.map((topic) => topic.id));
      if (!result.ok) { setTopics(previous); setError(result.message); return; }
      if (result.topics) setTopics(result.topics);
      setNotice(result.message);
    });
  }

  const list = <div className={styles.list}>{topics.map((topic) => <TopicRow key={topic.id} topic={topic} status={statuses.get(topic.id)!} sortable={mounted && !pending} disabled={pending} onToggle={() => setModal({ kind: "toggle", topic })} onRename={() => setModal({ kind: "rename", topic })} onDelete={() => setModal({ kind: "delete", topic })}/>)}</div>;

  return <section className={styles.panel}>
    <div className={styles.head}><div><h2>Прогресс тем</h2><p>{topics.length ? `Пройдено ${completed} из ${topics.length}${current ? ` · Текущая тема: ${current.title}` : " · Все темы пройдены"}` : "План тем пока пуст"}</p></div><div><button onClick={() => void openPicker()}>Выбрать шаблон</button><button onClick={() => setModal({ kind: "add" })}>Добавить тему</button></div></div>
    {topics.length > 0 && <div className={styles.progress}><i style={{ width: `${completed / topics.length * 100}%` }}/></div>}
    {notice && <p className={styles.notice}>{notice}</p>}{error && <p className={styles.error}>{error}</p>}
    {topics.length ? mounted ? <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}><SortableContext items={topics.map((topic) => topic.id)} strategy={verticalListSortingStrategy}>{list}</SortableContext></DndContext> : list : <p className={styles.empty}>Темы пока не добавлены.</p>}
    {topics.length > 0 && <button className={styles.snapshot} onClick={() => setModal({ kind: "snapshot" })}>Создать шаблон</button>}
    {modal && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setModal(null); }}><div className={styles.modal} role="dialog" aria-modal="true">
      <h3>{modal.kind === "add" ? "Добавить тему" : modal.kind === "rename" ? "Переименовать тему" : modal.kind === "snapshot" ? "Создать шаблон тем" : modal.kind === "picker" ? "Выбрать шаблон" : "Подтверждение"}</h3>
      {(modal.kind === "add" || modal.kind === "rename" || modal.kind === "snapshot") && <form onSubmit={(event) => formAction(event, (data) => modal.kind === "add" ? addStudentTopic(studentId, data) : modal.kind === "rename" ? renameStudentTopic(studentId, modal.topic.id, data) : createTemplateFromStudent(studentId, data))}><label>Название<input autoFocus name="title" maxLength={modal.kind === "snapshot" ? 150 : 200} defaultValue={modal.kind === "rename" ? modal.topic.title : ""} required/></label>{modal.kind === "snapshot" && <p>В шаблон войдут {topics.length} тем в текущем порядке.</p>}<Buttons close={() => setModal(null)} pending={pending}/></form>}
      {modal.kind === "delete" && <><p>Удалить тему “{modal.topic.title}”? Исходный шаблон не изменится.</p><Buttons close={() => setModal(null)} pending={pending} submit={() => run(() => deleteStudentTopic(studentId, modal.topic.id))}/></>}
      {modal.kind === "toggle" && <><p>{modal.topic.completedAt ? `Вернуть тему “${modal.topic.title}” в план? Статусы остальных тем не изменятся.` : `Отметить тему “${modal.topic.title}” пройденной? Статусы остальных тем не изменятся.`}</p><Buttons close={() => setModal(null)} pending={pending} submit={() => run(() => toggleStudentTopic(studentId, modal.topic.id))}/></>}
      {modal.kind === "picker" && <><input placeholder="Поиск..." value={search} onChange={(event) => setSearch(event.target.value)}/><div className={styles.templates}>{templates.filter((template) => template.title.toLocaleLowerCase("ru").includes(search.toLocaleLowerCase("ru"))).map((template) => <div key={template.id}><span><b>{template.title}</b><small>{template.itemCount} тем</small></span><button onClick={() => { setMode("replace"); setModal({ kind: "apply", template }); }}>Выбрать</button></div>)}</div></>}
      {modal.kind === "apply" && <><p>{topics.length ? `У ученика уже есть ${topics.length} тем. Как применить шаблон?` : `Добавить ${modal.template.itemCount} тем из шаблона “${modal.template.title}”?`}</p>{topics.length > 0 && <div className={styles.modes}><label><input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")}/>Заменить текущий план</label><label><input type="radio" checked={mode === "append"} onChange={() => setMode("append")}/>Добавить темы в конец</label>{mode === "replace" && <small>Текущий прогресс тем будет удалён. Сам шаблон не изменится.</small>}</div>}<Buttons close={() => setModal({ kind: "picker" })} pending={pending} submit={() => run(() => applyTopicTemplate(studentId, modal.template.id, topics.length ? mode : "append"))}/></>}
    </div></div>}
  </section>;
}

function Buttons({ close, pending, submit }: { close: () => void; pending: boolean; submit?: () => void }) { return <div className={styles.actions}><button type="button" onClick={close}>Отмена</button><button type={submit ? "button" : "submit"} onClick={submit} disabled={pending}>{pending ? "Сохраняем…" : "Сохранить"}</button></div>; }
function TopicRow({ topic, status, sortable, disabled, onToggle, onRename, onDelete }: { topic: StudentTopic; status: TopicStatus; sortable: boolean; disabled: boolean; onToggle: () => void; onRename: () => void; onDelete: () => void }) { const props = { topic, status, disabled, onToggle, onRename, onDelete }; return sortable ? <SortableTopic {...props}/> : <TopicContent {...props}/>; }
function SortableTopic(props: Omit<Parameters<typeof TopicContent>[0], "handle">) { const sortable = useSortable({ id: props.topic.id }); return <div ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}><TopicContent {...props} handle={<button className={styles.drag} {...sortable.attributes} {...sortable.listeners} aria-label="Переместить тему">⋮⋮</button>}/></div>; }
function TopicContent({ topic, status, disabled, onToggle, onRename, onDelete, handle }: { topic: StudentTopic; status: TopicStatus; disabled: boolean; onToggle: () => void; onRename: () => void; onDelete: () => void; handle?: React.ReactNode }) { return <article className={styles.row}>{handle ?? <span className={styles.drag}>⋮⋮</span>}<b>{topic.title}</b><span className={styles[status.toLowerCase()]}>{topicStatusLabels[status]}</span><button className={styles.statusAction} disabled={disabled} onClick={onToggle}>{topic.completedAt ? "Вернуть в план" : "Отметить пройденной"}</button><LessonActionsDropdown actions={[{ label: "Переименовать", onSelect: onRename }, { label: "Удалить тему", onSelect: onDelete, danger: true }]}/></article>; }
