"use client";

import BackLink from "@/components/back-link";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useRef, useState, useTransition } from "react";
import LessonActionsDropdown from "@/components/students/lesson-actions-dropdown";
import { releasePending, tryAcquirePending } from "@/lib/ui/pending-guard";
import { addTemplateItem, deleteTemplateItem, deleteTopicTemplate, renameTemplateItem, renameTopicTemplate, reorderTemplateItems } from "../actions";
import styles from "./template-editor.module.css";

type Item = { id: string; title: string; sort_order: number };
type Modal = { kind: "renameTemplate" | "deleteTemplate" | "add" } | { kind: "renameItem" | "deleteItem"; item: Item };

export default function TemplateEditor({ template, initialItems }: { template: { id: string; title: string }; initialItems: Item[] }) {
  const [items, setItems] = useState(initialItems);
  const [mounted, setMounted] = useState(false);
  const [modal, setModal] = useState<Modal | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const pendingGuard = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  useEffect(() => { setMounted(true); }, []);

  function openModal(next: Modal) {
    if (!pendingGuard.current) { setError(""); setModal(next); }
  }

  function closeModal() {
    if (!pendingGuard.current) setModal(null);
  }

  function run(task: () => Promise<{ ok: boolean; message: string }>) {
    if (!tryAcquirePending(pendingGuard)) return;
    setError("");
    start(async () => {
      try {
        const result = await task();
        if (!result.ok) setError(result.message);
        else setModal(null);
      } catch {
        setError("Не удалось выполнить действие. Попробуйте ещё раз.");
      } finally {
        releasePending(pendingGuard);
      }
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    run(() => modal?.kind === "add" ? addTemplateItem(template.id, data) : modal?.kind === "renameItem" ? renameTemplateItem(template.id, modal.item.id, data) : renameTopicTemplate(template.id, data));
  }

  function drag({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id || pendingGuard.current) return;
    const from = items.findIndex((item) => item.id === active.id);
    const to = items.findIndex((item) => item.id === over.id);
    if (from < 0 || to < 0 || !tryAcquirePending(pendingGuard)) return;
    const previous = items;
    const next = arrayMove(items, from, to);
    setError("");
    setItems(next);
    start(async () => {
      try {
        const result = await reorderTemplateItems(template.id, next.map((item) => item.id));
        if (!result.ok) { setItems(previous); setError(result.message); }
      } catch {
        setItems(previous);
        setError("Не удалось сохранить порядок тем.");
      } finally {
        releasePending(pendingGuard);
      }
    });
  }

  const rows = <div className={styles.list}>{items.map((item) => mounted ? <Sortable key={item.id} item={item} disabled={pending} rename={() => openModal({ kind: "renameItem", item })} remove={() => openModal({ kind: "deleteItem", item })}/> : <Row key={item.id} item={item} disabled={pending} rename={() => openModal({ kind: "renameItem", item })} remove={() => openModal({ kind: "deleteItem", item })}/>)}</div>;

  return <>
    <BackLink href="/admin/settings/topic-templates">К шаблонам</BackLink>
    <header className={styles.head}><div><h1>{template.title}</h1><p>{items.length} тем</p></div><div><button onClick={() => openModal({ kind: "renameTemplate" })}>Переименовать</button><button onClick={() => openModal({ kind: "deleteTemplate" })}>Удалить</button></div></header>
    <button className={styles.add} onClick={() => openModal({ kind: "add" })}>Добавить тему</button>
    {error && !modal && <p role="alert">{error}</p>}
    {mounted ? <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={drag}><SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>{rows}</SortableContext></DndContext> : rows}
    {!items.length && <p className={styles.empty}>Добавьте первую тему шаблона.</p>}
    {modal && <div className={styles.backdrop}><div className={styles.modal} role="dialog" aria-modal="true" aria-busy={pending} onKeyDown={(event) => { if (event.key !== "Escape") return; if (pendingGuard.current) { event.preventDefault(); event.stopPropagation(); } else closeModal(); }}>
      <h2>{modal.kind === "deleteTemplate" ? "Удалить шаблон" : modal.kind === "deleteItem" ? "Удалить тему" : modal.kind === "add" ? "Добавить тему" : "Переименовать"}</h2>
      {["add", "renameTemplate", "renameItem"].includes(modal.kind) && <form onSubmit={submit}><input autoFocus name="title" maxLength={modal.kind === "renameTemplate" ? 150 : 200} defaultValue={modal.kind === "renameTemplate" ? template.title : modal.kind === "renameItem" ? modal.item.title : ""} disabled={pending} required/>{error && <p role="alert">{error}</p>}<Buttons close={closeModal} pending={pending}/></form>}
      {modal.kind === "deleteItem" && <><p>Удалить тему “{modal.item.title}” из шаблона? Уже созданные планы учеников не изменятся.</p>{error && <p role="alert">{error}</p>}<Buttons close={closeModal} pending={pending} submit={() => run(() => deleteTemplateItem(template.id, modal.item.id))}/></>}
      {modal.kind === "deleteTemplate" && <form onSubmit={(event) => { event.preventDefault(); run(() => deleteTopicTemplate(template.id, new FormData(event.currentTarget))); }}><p>Удалить шаблон “{template.title}”? Уже добавленные планы учеников останутся без изменений.</p><input name="confirmation" placeholder="DELETE" disabled={pending} required/>{error && <p role="alert">{error}</p>}<Buttons close={closeModal} pending={pending}/></form>}
    </div></div>}
  </>;
}

function Buttons({ close, pending, submit }: { close: () => void; pending: boolean; submit?: () => void }) {
  return <div className={styles.actions}><button type="button" onClick={close} disabled={pending}>Отмена</button><button type={submit ? "button" : "submit"} onClick={submit} disabled={pending}>{pending ? "Сохраняем…" : "Сохранить"}</button></div>;
}

function Row({ item, rename, remove, handle, disabled = false }: { item: Item; rename: () => void; remove: () => void; handle?: React.ReactNode; disabled?: boolean }) {
  return <article className={styles.row} aria-busy={disabled}>{handle ?? <span>⋮⋮</span>}<b>{item.title}</b><LessonActionsDropdown actions={[{ label: "Переименовать", onSelect: rename }, { label: "Удалить тему", onSelect: remove, danger: true }]}/></article>;
}

function Sortable({ item, rename, remove, disabled }: { item: Item; rename: () => void; remove: () => void; disabled: boolean }) {
  const sortable = useSortable({ id: item.id, disabled });
  return <div ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}><Row item={item} rename={rename} remove={remove} disabled={disabled} handle={<button {...sortable.attributes} {...sortable.listeners} disabled={disabled} aria-label={`Изменить порядок темы «${item.title}»`}>⋮⋮</button>}/></div>;
}
