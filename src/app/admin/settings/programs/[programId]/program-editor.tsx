"use client";

import BackLink from "@/components/back-link";
import LessonActionsDropdown from "@/components/students/lesson-actions-dropdown";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useRef, useState, useTransition } from "react";
import { releasePending, tryAcquirePending } from "@/lib/ui/pending-guard";
import {
  addProgramTopic,
  deleteProgramTopic,
  renameProgram,
  renameProgramTopic,
  reorderProgramTopics,
} from "../actions";
import styles from "./program-editor.module.css";

type Topic = { id: string; title: string; sort_order: number };
type Modal =
  | { kind: "renameProgram" | "addTopic" }
  | { kind: "renameTopic" | "deleteTopic"; topic: Topic }
  | null;

export default function ProgramEditor({
  program,
  initialTopics,
}: {
  program: { id: string; name: string };
  initialTopics: Topic[];
}) {
  const [topics, setTopics] = useState(initialTopics);
  const [mounted, setMounted] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const pendingGuard = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => setMounted(true), []);

  function run(task: () => Promise<{ ok: boolean; message: string }>) {
    if (!tryAcquirePending(pendingGuard)) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await task();
        if (!result.ok) setError(result.message);
        else setModal(null);
      } catch {
        setError("Не удалось выполнить действие.");
      } finally {
        releasePending(pendingGuard);
      }
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (modal?.kind === "renameProgram") run(() => renameProgram(program.id, data));
    if (modal?.kind === "addTopic") run(() => addProgramTopic(program.id, data));
    if (modal?.kind === "renameTopic") run(() => renameProgramTopic(program.id, modal.topic.id, data));
  }

  function dragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id || pendingGuard.current) return;
    const from = topics.findIndex((topic) => topic.id === active.id);
    const to = topics.findIndex((topic) => topic.id === over.id);
    if (from < 0 || to < 0 || !tryAcquirePending(pendingGuard)) return;

    const previous = topics;
    const next = arrayMove(topics, from, to);
    setTopics(next);
    setError("");

    startTransition(async () => {
      try {
        const result = await reorderProgramTopics(program.id, next.map((topic) => topic.id));
        if (!result.ok) {
          setTopics(previous);
          setError(result.message);
        }
      } catch {
        setTopics(previous);
        setError("Не удалось сохранить порядок тем.");
      } finally {
        releasePending(pendingGuard);
      }
    });
  }

  const rows = (
    <div className={styles.list}>
      {topics.map((topic, index) => mounted ? (
        <SortableTopic
          key={topic.id}
          topic={topic}
          index={index}
          disabled={pending}
          rename={() => setModal({ kind: "renameTopic", topic })}
          remove={() => setModal({ kind: "deleteTopic", topic })}
        />
      ) : (
        <TopicRow
          key={topic.id}
          topic={topic}
          index={index}
          disabled={pending}
          rename={() => setModal({ kind: "renameTopic", topic })}
          remove={() => setModal({ kind: "deleteTopic", topic })}
        />
      ))}
    </div>
  );

  return (
    <div className={styles.page}>
      <BackLink href="/admin/settings/programs">К программам</BackLink>
      <header className={styles.head}>
        <div>
          <span>Программа обучения</span>
          <h1>{program.name}</h1>
          <p>{topics.length} тем · этот порядок используется для всех учеников программы</p>
        </div>
        <button onClick={() => setModal({ kind: "renameProgram" })}>Переименовать</button>
      </header>

      <button className={styles.add} onClick={() => setModal({ kind: "addTopic" })}>Добавить тему</button>
      {error && !modal && <p className={styles.error}>{error}</p>}

      {mounted ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
          <SortableContext items={topics.map((topic) => topic.id)} strategy={verticalListSortingStrategy}>
            {rows}
          </SortableContext>
        </DndContext>
      ) : rows}

      {!topics.length && <p className={styles.empty}>Добавьте первую тему программы.</p>}

      {modal && (
        <div
          className={styles.backdrop}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !pendingGuard.current) setModal(null);
          }}
        >
          <div className={styles.modal} role="dialog" aria-modal="true" aria-busy={pending}>
            <h2>
              {modal.kind === "renameProgram"
                ? "Переименовать программу"
                : modal.kind === "addTopic"
                  ? "Добавить тему"
                  : modal.kind === "renameTopic"
                    ? "Переименовать тему"
                    : "Удалить тему"}
            </h2>

            {modal.kind !== "deleteTopic" ? (
              <form onSubmit={submit}>
                <input
                  autoFocus
                  name={modal.kind === "renameProgram" ? "name" : "title"}
                  maxLength={modal.kind === "renameProgram" ? 100 : 200}
                  defaultValue={modal.kind === "renameProgram" ? program.name : modal.kind === "renameTopic" ? modal.topic.title : ""}
                  required
                  disabled={pending}
                />
                {error && <p className={styles.error}>{error}</p>}
                <ModalButtons close={() => setModal(null)} pending={pending} />
              </form>
            ) : (
              <>
                <p>
                  Удалить тему «{modal.topic.title}»? Она исчезнет из этой программы у всех учеников,
                  а её сохранённый прогресс будет удалён.
                </p>
                {error && <p className={styles.error}>{error}</p>}
                <ModalButtons
                  close={() => setModal(null)}
                  pending={pending}
                  submit={() => run(() => deleteProgramTopic(program.id, modal.topic.id))}
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ModalButtons({
  close,
  pending,
  submit,
}: {
  close: () => void;
  pending: boolean;
  submit?: () => void;
}) {
  return (
    <div className={styles.actions}>
      <button type="button" onClick={close} disabled={pending}>Отмена</button>
      <button type={submit ? "button" : "submit"} onClick={submit} disabled={pending}>
        {pending ? "Сохраняем…" : "Сохранить"}
      </button>
    </div>
  );
}

function TopicRow({
  topic,
  index,
  disabled,
  rename,
  remove,
  handle,
}: {
  topic: Topic;
  index: number;
  disabled: boolean;
  rename: () => void;
  remove: () => void;
  handle?: React.ReactNode;
}) {
  return (
    <article className={styles.row} aria-busy={disabled}>
      {handle ?? <span className={styles.drag}>⋮⋮</span>}
      <span className={styles.number}>{index + 1}</span>
      <b>{topic.title}</b>
      <LessonActionsDropdown actions={[
        { label: "Переименовать", onSelect: rename },
        { label: "Удалить тему", onSelect: remove, danger: true },
      ]}/>
    </article>
  );
}

function SortableTopic({
  topic,
  index,
  disabled,
  rename,
  remove,
}: {
  topic: Topic;
  index: number;
  disabled: boolean;
  rename: () => void;
  remove: () => void;
}) {
  const sortable = useSortable({ id: topic.id, disabled });
  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
    >
      <TopicRow
        topic={topic}
        index={index}
        disabled={disabled}
        rename={rename}
        remove={remove}
        handle={
          <button
            className={styles.drag}
            {...sortable.attributes}
            {...sortable.listeners}
            disabled={disabled}
            aria-label={`Изменить порядок темы «${topic.title}»`}
          >
            ⋮⋮
          </button>
        }
      />
    </div>
  );
}
