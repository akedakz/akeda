"use client";

import Link from "next/link";
import { useState } from "react";
import ResultsDonut from "./results-donut";
import ResultsLineChart from "./results-line-chart";
import type { StudentResultsData } from "./student-results-types";
import styles from "./student-results-panel.module.css";

const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const clamp = (value: number) => Math.max(0, Math.min(100, value));

function Bar({ value }: { value: number }) {
  return <div className={styles.bar} aria-hidden><i style={{ width: `${clamp(value)}%` }}/></div>;
}

export default function StudentResultsPanel({ studentId, data, loadError }: { studentId: string; data: StudentResultsData; loadError?: string }) {
  const [section, setSection] = useState<"homework" | "tests">("homework");
  const [visible, setVisible] = useState(10);
  const changeSection = (next: "homework" | "tests") => { setSection(next); setVisible(10); };

  if (loadError) return <section className={styles.panel}><h2>Результаты</h2><p className={styles.error}>{loadError}</p></section>;
  return <section className={styles.panel}>
    <h2>Результаты</h2>
    <article className={styles.overall}>
      <div><span>Общий прогресс</span><strong>{data.overall.percent}%</strong></div>
      <Bar value={data.overall.percent}/>
      <p>{data.overall.hasData ? "Прогресс рассчитан по темам, домашним заданиям, тестам и посещаемости." : "Пока недостаточно данных для оценки прогресса."}</p>
    </article>

    <div className={styles.metrics}>
      <article><span>Пройдено тем</span><strong>{data.topics.completed} из {data.topics.total}</strong><small>{Math.round(data.topics.percent)}%</small><Bar value={data.topics.percent}/></article>
      <article><span>Домашних заданий</span><strong>Выполнено {data.homework.completed}</strong><small>Средняя оценка: {data.homework.average === null ? "Нет данных" : `${number.format(data.homework.average)}/10`} · оценено {data.homework.graded}</small><Bar value={(data.homework.average ?? 0) * 10}/></article>
      <article><span>Проведено уроков</span><strong>{data.lessonsHeld}</strong><small>Прошедшие посещённые уроки</small></article>
      <article className={styles.attendance}><span>Посещаемость</span><div><ResultsDonut percent={data.attendance.percent}/><p><strong>{data.attendance.considered ? `${data.attendance.attended} из ${data.attendance.considered}` : "Нет данных"}</strong><small>учитываемых уроков</small></p></div></article>
      <article><span>Завершено тестов</span><strong>{data.tests.completed}</strong><small>Средний результат: {data.tests.averagePercent === null ? "Нет данных" : `${Math.round(data.tests.averagePercent)}%`}</small>{data.tests.averageScore !== null && data.tests.averageMaxScore !== null && <small>{number.format(data.tests.averageScore)} / {number.format(data.tests.averageMaxScore)} в среднем</small>}<Bar value={data.tests.averagePercent ?? 0}/></article>
      <article><span>Серия ДЗ</span><div className={styles.streaks}><p><small>Текущая серия</small><strong>{data.homework.currentStreak} ДЗ подряд</strong></p><p><small>Лучшая серия</small><strong>{data.homework.bestStreak} ДЗ</strong></p></div><small>ДЗ с оценкой 7/10 и выше</small></article>
    </div>

    <div className={styles.charts}>
      <article><ResultsLineChart title="Динамика ДЗ" points={data.charts.homework} maximum={10} suffix="/10"/></article>
      <article><ResultsLineChart title="Динамика тестов" points={data.charts.tests} maximum={100} suffix="%"/></article>
    </div>

    <div className={styles.segmented} role="tablist" aria-label="История результатов">
      <button role="tab" aria-selected={section === "homework"} onClick={() => changeSection("homework")}>Домашние задания</button>
      <button role="tab" aria-selected={section === "tests"} onClick={() => changeSection("tests")}>Тесты</button>
    </div>
    {section === "homework" ? <div className={styles.history} role="tabpanel">
      {!data.homework.history.length && <p className={styles.empty}>Проверенных домашних заданий пока нет.</p>}
      {data.homework.history.slice(0, visible).map((item) => <article key={item.lessonId}><div><time dateTime={item.lessonDate}>{item.dateLabel}</time><strong>{item.title}</strong>{item.comment && <p>Комментарий: {item.comment}</p>}</div><b>{item.grade === null ? "Без оценки" : `${item.grade}/10`}</b></article>)}
      {visible < data.homework.history.length && <button className={styles.more} onClick={() => setVisible((count) => count + 10)}>Показать ещё</button>}
    </div> : <div className={styles.history} role="tabpanel">
      {!data.tests.history.length && <p className={styles.empty}>Завершённых тестов пока нет.</p>}
      {data.tests.history.slice(0, visible).map((item) => <article key={item.assignmentId}><div><strong>{item.title}</strong><p>Результат: {number.format(item.score)}/{number.format(item.maxScore)} · {Math.round(item.bestPercent)}%</p><small>Завершён: {item.completedAtLabel}</small></div><Link href={`/admin/students/${studentId}/tests/${item.assignmentId}/attempts/${item.attemptId}`}>Открыть</Link></article>)}
      {visible < data.tests.history.length && <button className={styles.more} onClick={() => setVisible((count) => count + 10)}>Показать ещё</button>}
    </div>}
  </section>;
}
