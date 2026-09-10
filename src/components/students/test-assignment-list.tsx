"use client";

import Link from "next/link";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { deleteTestAssignment } from "@/app/admin/students/[id]/test-assignment-actions";
import AssignTestModal from "./assign-test-modal";
import ComposeTestModal from "./compose-test-modal";
import { initialAssignmentState, type AssignmentActionState, type AssignmentListItem } from "./test-assignment-types";
import styles from "./test-assignments.module.css";

function formatDate(value: string, withTime = false) {
  return new Intl.DateTimeFormat("ru-RU", withTime ? { timeZone: "Asia/Almaty", dateStyle: "medium", timeStyle: "short" } : { timeZone: "Asia/Almaty", dateStyle: "medium" }).format(new Date(value));
}

const statusLabels: Record<AssignmentListItem["status"], string> = {
  COMPLETED: "Завершён",
  REVIEW: "Требует проверки",
  OVERDUE: "Просрочен",
  IN_PROGRESS: "В процессе",
  EXPECTED: "Ожидается",
};

function DeleteButton({ studentId, assignment }: { studentId: string; assignment: AssignmentListItem }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(async (previousState: AssignmentActionState, formData: FormData) => {
    const result = await deleteTestAssignment(studentId, assignment.id, previousState, formData);
    if (result.status === "success") setOpen(false);
    return result;
  }, initialAssignmentState);
  return <>
    <button className={styles.deleteButton} type="button" disabled={pending} onClick={() => setOpen(true)}>Удалить</button>
    {open && <div className={styles.deleteBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setOpen(false); }}>
      <section className={styles.deleteDialog} role="dialog" aria-modal="true" aria-labelledby={`delete-assignment-${assignment.id}`}>
        <h2 id={`delete-assignment-${assignment.id}`}>{assignment.hasAttempts ? "Удалить назначение и результаты?" : "Удалить назначение?"}</h2>
        <p>{assignment.hasAttempts ? "Все попытки, ответы и результаты ученика по этому тесту будут безвозвратно удалены." : `Назначение «${assignment.title}» исчезнет у ученика.`}</p>
        <form action={action} className={styles.deleteActions}>
          <button className={styles.secondary} type="button" disabled={pending} onClick={() => setOpen(false)}>Отмена</button>
          <button className={styles.confirmDelete} type="submit" disabled={pending}>{pending ? "Удаляем…" : "Удалить"}</button>
        </form>
        {state.status === "error" && <p className={styles.deleteError} role="alert">{state.message}</p>}
      </section>
    </div>}
  </>;
}

export default function TestAssignmentList({ studentId, assignments, loadError }: { studentId: string; assignments: AssignmentListItem[]; loadError?: string }) {
  const [open, setOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const opener = useRef<HTMLButtonElement>(null);
  const composeOpener = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const success = useCallback((message: string) => { setOpen(false); setNotice(message); }, []);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 4000); return () => window.clearTimeout(timer); }, [notice]);

  return <section className={styles.assignmentSection} aria-labelledby="assignments-title">
    <div className={styles.sectionHeader}><div><h2 id="assignments-title">Назначенные тесты</h2><p>Индивидуальные задания ученика</p></div><div className={styles.assignmentHeaderActions}><button ref={opener} className={styles.assignButton} type="button" onClick={() => setOpen(true)}>Назначить тест</button><button ref={composeOpener} className={styles.composeButton} type="button" onClick={() => setComposeOpen(true)}>Составить тест</button></div></div>
    {notice && <p className={styles.success} role="status">{notice}</p>}
    {loadError ? <p className={styles.loadError} role="alert">{loadError}</p> : assignments.length ? <div className={styles.assignmentList}>{assignments.map((assignment) => <article className={styles.assignmentCard} key={assignment.id}>
      <span className={styles.assignmentIcon} aria-hidden>Т</span><div className={styles.assignmentCopy}><div className={styles.titleLine}><h3>{assignment.title}</h3><strong className={`${styles.status} ${styles[assignment.status.toLowerCase()]}`}>{statusLabels[assignment.status]}</strong></div><p>{assignment.deadlineAt ? `До ${formatDate(assignment.deadlineAt, true)}` : "Без дедлайна"}</p>{assignment.latestSubmittedAttemptId && assignment.score !== null && assignment.maxScore !== null ? <small className={styles.result}>Результат: {assignment.score}/{assignment.maxScore} · {assignment.maxScore > 0 ? Math.round(assignment.score / assignment.maxScore * 100) : 0}% · завершён {formatDate(assignment.submittedAt!, true)}</small> : <small>Назначен {formatDate(assignment.createdAt)}</small>}</div><div className={styles.cardActions}><Link href={assignment.latestSubmittedAttemptId ? `/admin/students/${studentId}/tests/${assignment.id}/attempts/${assignment.latestSubmittedAttemptId}` : `/admin/students/${studentId}/tests/${assignment.id}`}>Открыть</Link><DeleteButton studentId={studentId} assignment={assignment}/></div>
    </article>)}</div> : <p className={styles.empty}>У этого ученика пока нет назначенных тестов.</p>}
    {open && <AssignTestModal
      studentId={studentId} activeSourceTestIds={assignments.flatMap((assignment) => !assignment.latestSubmittedAttemptId && assignment.sourceTestId ? [assignment.sourceTestId] : [])} open onClose={close} onSuccess={success} opener={opener}
    />}
    {composeOpen && <ComposeTestModal studentId={studentId} open onClose={() => setComposeOpen(false)} onSuccess={(message) => { setComposeOpen(false); setNotice(message); }} opener={composeOpener}/>}
  </section>;
}
