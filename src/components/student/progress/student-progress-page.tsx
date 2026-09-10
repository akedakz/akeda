"use client";

import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import StudentProgressModal from "./student-progress-modal";
import type { StudentProgressData } from "./student-progress-types";
import styles from "./student-progress-page.module.css";
import trainerStyles from "./trainer-progress-summary.module.css";

type ModalName = "topics" | "homework" | "tests" | "trainers" | null;

export default function StudentProgressPage({ data, mode = "student", studentId, showHeader = true }: { data: StudentProgressData; mode?: "student" | "admin"; studentId?: string; showHeader?: boolean }) {
  const [modal, setModal] = useState<ModalName>(null);
  const closeModal = useCallback(() => setModal(null), []);
  return <div className={styles.page}>
    {showHeader && <header className={styles.heading}><span>{mode === "admin" ? "Результаты ученика" : "Личный кабинет"}</span><h1>{mode === "admin" ? "Прогресс" : "Мой прогресс"}</h1><p>{mode === "admin" ? "Темы, уроки, домашние задания, тесты и тренажёры" : "Ваши темы, уроки, домашние задания, тесты и тренажёры"}</p></header>}
    <div className={styles.layout}>
      <section className={`${styles.card} ${styles.topics}`}>
        <SectionHead icon="↗" title="Темы"><button className={styles.textAction} type="button" onClick={() => setModal("topics")}>Все темы</button></SectionHead>
        {data.topics.total ? <div className={styles.topicBody}><div><small>Текущая тема</small><strong className={styles.topicTitle}>{data.topics.allCompleted ? "Все темы завершены" : data.topics.currentTitle}</strong><p>{data.topics.completed} из {data.topics.total} тем завершено</p></div><div className={styles.topicProgress}><b>{data.topics.percent}%</b><div className={styles.progress} aria-label={`Завершено ${data.topics.percent}%`}><span style={{ width: `${data.topics.percent}%` }}/></div></div></div> : <p className={styles.empty}>Темы пока не добавлены.</p>}
      </section>

      <div className={styles.split}>
        <section className={`${styles.card} ${styles.lessons}`}>
          <SectionHead icon="◷" title="Уроки"/>
          {data.lessons.total ? <><div className={styles.compactMetric}><strong>{data.lessons.attendancePercent === null ? "—" : `${Math.round(data.lessons.attendancePercent)}%`}</strong><span>Посещаемость</span></div><dl><div><dt>Всего</dt><dd>{formatNumber(data.lessons.total)}</dd></div><div><dt>Посещено</dt><dd>{formatNumber(data.lessons.attended)}</dd></div><div><dt>Пропущено</dt><dd>{formatNumber(data.lessons.missed)}</dd></div></dl></> : <p className={styles.empty}>Завершённых уроков пока нет.</p>}
        </section>

        <section className={`${styles.card} ${styles.tests}`}>
          <SectionHead icon="✓" title="Тесты"><button className={styles.textAction} type="button" onClick={() => setModal("tests")}>Все тесты</button></SectionHead>
          {data.tests.completed ? <><div className={styles.compactMetric}><strong>{data.tests.averagePercent === null ? "—" : `${Math.round(data.tests.averagePercent)}%`}</strong><span>Средний результат</span></div><div className={styles.inlineMetrics}><span>Завершено <b>{formatNumber(data.tests.completed)}</b></span><span>Пропущено <b>{formatNumber(data.tests.missed)}</b></span></div></> : <p className={styles.empty}>Завершённых тестов пока нет.</p>}
        </section>
      </div>

      <section className={`${styles.card} ${styles.homework}`}>
        <SectionHead icon="⌑" title="Домашние задания"><button className={styles.textAction} type="button" onClick={() => setModal("homework")}>Все домашние задания</button></SectionHead>
        {data.homework.graded ? <div className={styles.homeworkBody}><div className={styles.compactMetric}><strong>{score(data.homework.average)}</strong><span>Средняя оценка за всё время</span></div><div className={styles.inlineMetrics}><span>За {data.homework.monthLabel.toLowerCase()} <b>{score(data.homework.monthAverage)}</b></span><span>Оценено <b>{formatNumber(data.homework.graded)}</b></span></div></div> : <p className={styles.empty}>Оценённых домашних заданий пока нет.</p>}
      </section>

      <section className={`${styles.card} ${trainerStyles.card}`}>
        <SectionHead icon="◎" title="Тренажёры"><button className={styles.textAction} type="button" onClick={() => setModal("trainers")}>Все тренажёры</button></SectionHead>
        <div className={styles.trainerIntro}><div className={styles.compactMetric}><strong>{data.trainers.progressPercent}%</strong><span>Общий прогресс Quick Problems и Theory</span></div><div className={styles.inlineMetrics}><span>Завершено <b>{formatNumber(data.trainers.completed)}</b></span><span>Активно <b>{formatNumber(data.trainers.incomplete)}</b></span></div></div>
        <div className={styles.trainerRows}>{data.trainers.types.map((item) => <TrainerProgressRow key={item.type} label={item.typeLabel} percent={item.progressPercent}/>)}<TrainerProgressRow label="Formula Recall" percent={data.formulaRecall.progressPercent} detail={`Изучено: ${formatNumber(data.formulaRecall.mastered)} из ${formatNumber(data.formulaRecall.assigned)} формул`}/><div className={styles.countTrainer}><div><strong>Mistake Review</strong><span>{formatNumber(data.mistakes.corrected)} исправлено</span></div><b>{formatNumber(data.mistakes.active)} <small>активных задач</small></b></div></div>
      </section>

      <section className={`${styles.card} ${styles.statistics}`}>
        <SectionHead icon="∑" title="Статистика"/>
        <div className={styles.statGrid}><Stat value={data.statistics.testResponses} label="Решено в тестах"/><Stat value={data.statistics.trainerCompletions} label="Решено в тренажёрах"/><Stat value={data.statistics.formulasMastered} label="Изучено формул"/><Stat value={data.statistics.mistakesCorrected} label="Исправлено ошибок"/></div>
      </section>
    </div>

    <StudentProgressModal title="Все темы" open={modal === "topics"} onClose={closeModal}><div className={styles.modalList}>{data.topics.items.length ? data.topics.items.map((topic) => <article className={styles.topicRow} data-status={topic.status} key={topic.id}><span>{topic.status === "COMPLETED" ? "✓" : topic.number}</span><strong>{topic.title}</strong><em>{topic.status === "COMPLETED" ? "Завершена" : topic.status === "CURRENT" ? "Текущая" : "Ожидает"}</em></article>) : <p className={styles.modalEmpty}>Темы пока не добавлены.</p>}</div></StudentProgressModal>
    <StudentProgressModal title="Все домашние задания" open={modal === "homework"} onClose={closeModal}><div className={styles.modalList}>{data.homework.items.length ? data.homework.items.map((item) => <article className={styles.homeworkRow} key={item.id}><div><strong>{item.title}</strong><time>{item.dateLabel}</time>{item.comment && <p>{item.comment}</p>}</div><b>{item.grade === null ? "Без оценки" : `${item.grade} / 10`}</b></article>) : <p className={styles.modalEmpty}>Домашние задания пока не добавлены.</p>}</div></StudentProgressModal>
    <StudentProgressModal title="Все тесты" open={modal === "tests"} onClose={closeModal}><div className={styles.modalList}>{data.tests.items.length ? data.tests.items.map((item) => { const content = <><div><strong>{item.title}</strong>{item.dateLabel && <time>{item.dateLabel}</time>}</div><b>{item.status === "COMPLETED" ? `${Math.round(item.percent ?? 0)}%` : item.status === "MISSED" ? "Пропущен" : "Не завершён"}</b></>; const href = item.attemptId ? mode === "admin" && studentId ? `/admin/students/${studentId}/tests/${item.assignmentId}/attempts/${item.attemptId}` : `/student/tests/${item.assignmentId}/attempts/${item.attemptId}` : null; return href ? <Link className={styles.testRow} href={href} key={item.assignmentId}>{content}</Link> : <article className={styles.testRow} key={item.assignmentId}>{content}</article>; }) : <p className={styles.modalEmpty}>Тесты пока не назначены.</p>}</div></StudentProgressModal>
    <StudentProgressModal title="Все тренажёры" open={modal === "trainers"} onClose={closeModal}><div className={styles.modalList}>{data.trainers.items.length ? data.trainers.items.map((item) => <article className={trainerStyles.row} key={`${item.status}:${item.id}`}><div><small className={trainerStyles.type}>{item.typeLabel}</small><strong>{item.title}</strong></div><div className={trainerStyles.rowResult}><strong>{item.progressPercent}%</strong><b className={`${trainerStyles.status}${item.status === "COMPLETED" ? ` ${trainerStyles.completed}` : ""}`}>{item.status === "COMPLETED" ? "Завершён" : "Активен"}</b></div></article>) : <p className={styles.modalEmpty}>Тренажёров пока нет.</p>}</div></StudentProgressModal>
  </div>;
}

function score(value: number | null) { return value === null ? "—" : `${value.toFixed(1)} / 10`; }
const numberFormat = new Intl.NumberFormat("ru-RU");
function formatNumber(value: number) { return numberFormat.format(value); }
function SectionHead({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) { return <div className={styles.cardHead}><span className={styles.icon} aria-hidden="true">{icon}</span><h2>{title}</h2>{children && <div className={styles.headAction}>{children}</div>}</div>; }
function TrainerProgressRow({ label, percent, detail }: { label: string; percent: number; detail?: string }) { return <div className={styles.trainerRow}><div><strong>{label}</strong>{detail && <span>{detail}</span>}</div><b>{percent}%</b><div className={styles.progress} aria-label={`${label}: ${percent}%`}><span style={{ width: `${percent}%` }}/></div></div>; }
function Stat({ value, label }: { value: number; label: string }) { return <div className={styles.stat}><strong>{formatNumber(value)}</strong><span>{label}</span></div>; }
