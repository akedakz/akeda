"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { completeOverviewTopic } from "@/app/admin/actions";
import { deleteLessonHomework, deletePastLesson, saveLessonHomework, setFutureLessonStatus, setLessonAttendance } from "@/app/admin/students/[id]/lesson-actions";
import LessonActionsDropdown, { type LessonMenuAction } from "@/components/students/lesson-actions-dropdown";
import { lessonStatusLabels } from "@/lib/lessons/lesson-status";
import type { OverviewData, OverviewLesson } from "./overview-types";
import styles from "./overview-dashboard.module.css";

type Modal = { kind: "future"; lesson: OverviewLesson; value: string } | { kind: "attendance"; lesson: OverviewLesson } | { kind: "homework"; lesson: OverviewLesson } | { kind: "delete"; lesson: OverviewLesson } | { kind: "topic"; lesson: OverviewLesson } | null;
const zone = "Asia/Almaty";
const time = new Intl.DateTimeFormat("ru-RU", { timeZone: zone, hour: "2-digit", minute: "2-digit" });
const resultDate = new Intl.DateTimeFormat("ru-RU", { timeZone: zone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function OverviewDashboard({ data, loadError, showHeader = true }: { data: OverviewData; loadError?: string; showHeader?: boolean }) {
  const [tab, setTab] = useState<"scheduled" | "completed">("scheduled");
  const [modal, setModal] = useState<Modal>(null);
  const [attendance, setAttendance] = useState("ATTENDED");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const modalRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const lessons = tab === "scheduled" ? data.scheduled : data.completed;
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 4000); return () => window.clearTimeout(timer); }, [notice]);
  useEffect(() => {
    if (!modal) return;
    requestAnimationFrame(() => cancelRef.current?.focus());
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) setModal(null);
      if (event.key !== "Tab" || !modalRef.current) return;
      const nodes = [...modalRef.current.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)")];
      if (!nodes.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", keydown); };
  }, [modal, pending]);
  function close() { if (!pending) { setModal(null); setError(""); } }
  function run(task: () => Promise<{ ok: boolean; message: string }>) {
    setError("");
    startTransition(async () => { const response = await task(); if (!response.ok) { setError(response.message); return; } setModal(null); setNotice(response.message); });
  }
  function openAttendance(lesson: OverviewLesson) { setAttendance(lesson.status === "NO_SHOW" ? "NO_SHOW" : lesson.status === "LATE_CANCELLED" ? "LATE_CANCELLED" : "ATTENDED"); setModal({ kind: "attendance", lesson }); }
  return <>
    {showHeader ? <header className={styles.header}><span>NSP · Управление</span><h1>Обзор</h1><p>{data.dateLabel}</p></header> : <p style={{ margin: "0 0 18px", color: "#69746d" }}>{data.dateLabel}</p>}
    <section className={styles.counters} aria-label="Показатели дня">
      <article><span>Уроков сегодня</span><strong>{data.counters.total}</strong></article>
      <article><span>Проведено</span><strong>{data.counters.held}</strong></article>
      <article><span>Осталось</span><strong>{data.counters.remaining}</strong></article>
      <article><span>На проверке</span><strong>{data.counters.manualReview}</strong></article>
    </section>
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {loadError ? <p className={styles.error}>{loadError}</p> : <>
      <section className={styles.schedule}>
        <div className={styles.sectionHead}><h2>Расписание на сегодня</h2><div className={styles.tabs} role="tablist" aria-label="Уроки сегодня"><button role="tab" aria-selected={tab === "scheduled"} onClick={() => setTab("scheduled")}>Запланировано {data.scheduled.length}</button><button role="tab" aria-selected={tab === "completed"} onClick={() => setTab("completed")}>Пройдено {data.completed.length}</button></div></div>
        {lessons.length ? <div className={styles.lessons}>{lessons.map((lesson) => <LessonCard key={lesson.id} lesson={lesson} past={tab === "completed"} openFuture={(value) => setModal({ kind: "future", lesson, value })} openAttendance={() => openAttendance(lesson)} openHomework={() => setModal({ kind: "homework", lesson })} openDelete={() => setModal({ kind: "delete", lesson })} openTopic={() => setModal({ kind: "topic", lesson })}/>)}</div> : <p className={styles.empty}>{data.counters.total === 0 ? "Сегодня занятий нет." : tab === "scheduled" ? "На сегодня больше нет запланированных уроков." : "Сегодня ещё не было завершённых уроков."}</p>}
      </section>
      <RecentResults data={data}/>
    </>}
    {modal && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><div ref={modalRef} className={styles.modal} role="dialog" aria-modal="true"><h2>{modal.kind === "attendance" ? "Посещаемость" : modal.kind === "homework" ? "Домашнее задание" : "Подтверждение"}</h2>
      {modal.kind === "future" && <><p>{modal.value === "SCHEDULED" ? "Вернуть урок в запланированные?" : `Изменить статус урока на «${modal.value === "CANCELLED_BY_TEACHER" ? "Отменён преподавателем" : "Отменён учеником"}»?`}</p><ModalError value={error}/><Actions cancelRef={cancelRef} close={close} pending={pending} submit={() => run(() => setFutureLessonStatus(modal.lesson.studentId, modal.lesson.id, modal.value))}/></>}
      {modal.kind === "attendance" && <><div className={styles.radios}>{[["ATTENDED", "Посещение было"], ["NO_SHOW", "Не посещён"], ["LATE_CANCELLED", "Поздно отменён"]].map(([value, label]) => <label key={value}><input type="radio" checked={attendance === value} onChange={() => setAttendance(value)}/>{label}</label>)}</div><ModalError value={error}/><Actions cancelRef={cancelRef} close={close} pending={pending} submit={() => run(() => setLessonAttendance(modal.lesson.studentId, modal.lesson.id, attendance))}/></>}
      {modal.kind === "homework" && <HomeworkForm
        lesson={modal.lesson} error={error} pending={pending} cancelRef={cancelRef} close={close}
        save={(formData) => run(() => saveLessonHomework(modal.lesson.studentId, modal.lesson.id, formData))}
        remove={() => run(() => deleteLessonHomework(modal.lesson.studentId, modal.lesson.id))}
      />}
      {modal.kind === "delete" && <><p>Удалить урок {time.format(new Date(modal.lesson.startsAt))}–{time.format(new Date(modal.lesson.endsAt))}? Вместе с ним будет удалена связанная запись ДЗ.</p><ModalError value={error}/><Actions cancelRef={cancelRef} close={close} pending={pending} submitLabel="Удалить урок" submit={() => run(() => deletePastLesson(modal.lesson.studentId, modal.lesson.id))}/></>}
      {modal.kind === "topic" && modal.lesson.topic && <><p>Отметить тему “{modal.lesson.topic.title}” пройденной?</p><ModalError value={error}/><Actions cancelRef={cancelRef} close={close} pending={pending} submitLabel="Закрыть тему" submit={() => run(() => completeOverviewTopic(modal.lesson.studentId, modal.lesson.topic!.id))}/></>}
    </div></div>}
  </>;
}

function LessonCard({ lesson, past, openFuture, openAttendance, openHomework, openDelete, openTopic }: { lesson: OverviewLesson; past: boolean; openFuture: (value: string) => void; openAttendance: () => void; openHomework: () => void; openDelete: () => void; openTopic: () => void }) {
  const actions: LessonMenuAction[] = [];
  if (past) actions.push({ label: "Изменить посещаемость", onSelect: openAttendance }, { label: "Домашнее задание", onSelect: openHomework }, { label: "Удалить урок", onSelect: openDelete, danger: true });
  else if (lesson.status === "CANCELLED_BY_TEACHER" || lesson.status === "CANCELLED_BY_STUDENT") actions.push({ label: "Вернуть в запланированные", onSelect: () => openFuture("SCHEDULED") });
  else actions.push({ label: "Отменён преподавателем", onSelect: () => openFuture("CANCELLED_BY_TEACHER") }, { label: "Отменён учеником", onSelect: () => openFuture("CANCELLED_BY_STUDENT") });
  return <article className={`${styles.lesson} ${lesson.status.startsWith("CANCELLED") ? styles.cancelled : ""}`}><div className={styles.lessonTime}><strong>{time.format(new Date(lesson.startsAt))}–{time.format(new Date(lesson.endsAt))}</strong><span className={`${styles.badge} ${styles[lesson.status.toLowerCase()]}`}>{lessonStatusLabels[lesson.status]}</span></div><div className={styles.lessonInfo}><Link href={`/admin/students/${lesson.studentId}?tab=lessons`}>{lesson.studentName}</Link><p>{lesson.topicState === "CURRENT" ? <>Текущая тема: <Link href={`/admin/students/${lesson.studentId}?tab=topics`}>{lesson.topic?.title}</Link></> : lesson.topicState === "COMPLETED" ? "Все темы пройдены" : <Link href={`/admin/students/${lesson.studentId}?tab=topics`}>План тем не составлен</Link>}</p>{past && lesson.homework && <small>ДЗ: {lesson.homework.title}{lesson.homework.grade === null ? " · без оценки" : ` · ${lesson.homework.grade}/10`}</small>}</div><div className={styles.lessonActions}>{lesson.topic && <button onClick={openTopic}>Закрыть тему</button>}{past && <><button onClick={openAttendance}>Посещаемость</button><button onClick={openHomework}>Домашнее задание</button></>}<LessonActionsDropdown actions={actions}/></div></article>;
}

function RecentResults({ data }: { data: OverviewData }) { return <section className={styles.results}><h2>Последние результаты тестов</h2>{data.recentResults.length ? <div>{data.recentResults.map((result) => <Link href={`/admin/students/${result.studentId}/tests/${result.assignmentId}`} key={`${result.assignmentId}-${result.attemptNumber}`}><span>{result.studentName}</span><strong>{result.title}</strong><p>{result.score}/{result.maxScore} · {Math.round(result.percent)}%</p><small>{resultDate.format(new Date(result.submittedAt))} · попытка {result.attemptNumber}</small></Link>)}</div> : <p className={styles.empty}>Завершённых тестов пока нет.</p>}</section>; }
function ModalError({ value }: { value: string }) { return value ? <p className={styles.modalError}>{value}</p> : null; }
function Actions({ cancelRef, close, pending, submit, submitLabel = "Сохранить" }: { cancelRef: React.RefObject<HTMLButtonElement | null>; close: () => void; pending: boolean; submit?: () => void; submitLabel?: string }) { return <div className={styles.modalActions}><button ref={cancelRef} type="button" onClick={close} disabled={pending}>Отмена</button><button type={submit ? "button" : "submit"} onClick={submit} disabled={pending}>{pending ? "Сохраняем…" : submitLabel}</button></div>; }
function HomeworkForm({ lesson, error, pending, cancelRef, close, save, remove }: { lesson: OverviewLesson; error: string; pending: boolean; cancelRef: React.RefObject<HTMLButtonElement | null>; close: () => void; save: (data: FormData) => void; remove: () => void }) { return <form className={styles.homework} onSubmit={(event) => { event.preventDefault(); save(new FormData(event.currentTarget)); }}><label>Название<input autoFocus name="title" maxLength={200} required defaultValue={lesson.homework?.title ?? ""}/></label><label>Оценка<select name="grade" defaultValue={lesson.homework?.grade ?? ""}><option value="">Без оценки</option>{Array.from({ length: 11 }, (_, grade) => <option key={grade} value={grade}>{grade}</option>)}</select></label><label>Комментарий<textarea name="comment" maxLength={500} defaultValue={lesson.homework?.comment ?? ""}/></label><ModalError value={error}/>{lesson.homework && <button className={styles.removeHomework} type="button" onClick={remove} disabled={pending}>Удалить запись</button>}<Actions cancelRef={cancelRef} close={close} pending={pending}/></form>; }
