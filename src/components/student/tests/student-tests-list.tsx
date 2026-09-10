"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StudentAssignmentSummary } from "@/lib/tests/student-test-types";
import Link from "./intent-prefetch-link";
import { waitForAttemptSaves } from "./test-answer-save-coordinator";
import styles from "./student-tests.module.css";

const date = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", year: "numeric" });
const deadline = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function questionCountLabel(count: number) {
  if (count < 0) return "Количество недоступно";
  const mod100 = count % 100;
  const mod10 = count % 10;
  const word = mod100 >= 11 && mod100 <= 14 ? "вопросов" : mod10 === 1 ? "вопрос" : mod10 >= 2 && mod10 <= 4 ? "вопроса" : "вопросов";
  return `${count} ${word}`;
}

export default function StudentTestsList({ pending, completed }: { pending: StudentAssignmentSummary[]; completed: StudentAssignmentSummary[] }) {
  const [tab, setTab] = useState<"pending" | "completed">("pending");
  const items = tab === "pending" ? pending : completed;
  return <><div className={styles.tabs} role="tablist" aria-label="Состояние тестов"><button role="tab" aria-selected={tab === "pending"} onClick={() => setTab("pending")}>Нужно пройти <b>{pending.length}</b></button><button role="tab" aria-selected={tab === "completed"} onClick={() => setTab("completed")}>Завершённые <b>{completed.length}</b></button></div>{items.length ? <div className={styles.list}>{items.map((item) => <article className={item.completed ? styles.completed : styles.pending} key={item.id}>
    <div className={styles.info}><h2>{item.title}</h2><div className={styles.metadata}><span>{questionCountLabel(item.questionCount)}</span><span>Назначен: {date.format(new Date(item.createdAt))}</span>{!item.completed && item.deadlineAt && <span className={item.overdue ? styles.danger : item.urgent ? styles.urgent : styles.deadline}>Дедлайн: {deadline.format(new Date(item.deadlineAt))}</span>}</div></div>
    <div className={styles.aside}>{item.completed && item.score !== null && item.maxScore !== null && <div className={styles.result} aria-label={`Результат: ${item.score} из ${item.maxScore}, ${Math.round(item.score / item.maxScore * 100)} процентов`}><strong>{Math.round(item.score / item.maxScore * 100)}%</strong><span>{item.score} / {item.maxScore}</span></div>}{item.action === "EXPIRED" && !item.activeAttemptId ? <button disabled>Срок истёк</button> : item.action === "CONTINUE" && item.activeAttemptId ? <ResumeLink assignmentId={item.id} attemptId={item.activeAttemptId} /> : <Link href={`/student/tests/${item.id}`}>{item.completed ? "Результат" : "Начать"}</Link>}</div>
  </article>)}</div> : <p className={styles.empty}>{tab === "pending" ? "Назначенных тестов пока нет." : "Завершённых тестов пока нет."}</p>}</>;
}

function ResumeLink({ assignmentId, attemptId }: { assignmentId: string; attemptId: string }) {
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const href = `/student/tests/${assignmentId}/attempts/${attemptId}`;
  return <a href={href} aria-disabled={opening} onClick={(event) => {
    event.preventDefault();
    if (opening) return;
    setOpening(true);
    void waitForAttemptSaves(attemptId).then(() => {
      router.push(`${href}?resume=${crypto.randomUUID()}`);
    });
  }}>{opening ? "Открываем…" : "Продолжить"}</a>;
}
