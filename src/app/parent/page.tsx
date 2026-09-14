import { redirect } from "next/navigation";
import StudentProgressPage from "@/components/student/progress/student-progress-page";
import { formatKzt, formatLessonEquivalents } from "@/lib/finance/types";
import { loadStudentFinance } from "@/lib/finance/server";
import { loadParentChildren, requireParentChild } from "@/lib/parent/access";
import { loadStudentProgressByStudentId } from "@/lib/progress/student-progress";
import styles from "./parent.module.css";

type ResultRow = { id: string; assignment_id: string; score: number | null; max_score: number | null; submitted_at: string };
type AssignmentRow = { id: string; title: string };

export default async function ParentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const children = await loadParentChildren();
  if (children === null) redirect("/dashboard");
  if (!children.length) return <main className={styles.page}><section className={styles.empty}><span>Кабинет родителя</span><h1>Дети пока не привязаны</h1><p>Попросите преподавателя привязать ученика к вашему аккаунту.</p></section></main>;

  const query = await searchParams;
  const requested = Array.isArray(query.student) ? query.student[0] : query.student;
  const selectedId = children.some((child) => child.id === requested) ? requested! : children[0].id;
  const access = await requireParentChild(selectedId);
  if (!access) return <main className={styles.page}><section className={styles.empty}><h1>Ученик недоступен</h1><p>Связь с учеником не найдена.</p></section></main>;

  const { admin } = access.context;
  const now = new Date().toISOString();
  const [nextLesson, schedule, attempts, progress, finance] = await Promise.all([
    admin.from("student_lessons").select("id,starts_at,ends_at").eq("student_id", selectedId).is("deleted_at", null).is("status_override", null).gt("ends_at", now).order("starts_at").limit(1).maybeSingle(),
    admin.from("student_schedule_slots").select("id,weekday,start_time,duration_minutes").eq("student_id", selectedId).is("valid_until", null).order("weekday").order("start_time"),
    admin.from("test_attempts").select("id,assignment_id,score,max_score,submitted_at").eq("student_id", selectedId).not("submitted_at", "is", null).order("submitted_at", { ascending: false }).limit(10),
    loadStudentProgressByStudentId(selectedId),
    loadStudentFinance(selectedId),
  ]);
  const attemptRows = (attempts.data ?? []) as ResultRow[];
  const assignmentIds = [...new Set(attemptRows.map((attempt) => attempt.assignment_id))];
  const assignments = assignmentIds.length ? await admin.from("test_assignments").select("id,title").eq("student_id", selectedId).in("id", assignmentIds) : { data: [], error: null };
  const titleById = new Map(((assignments.data ?? []) as AssignmentRow[]).map((item) => [item.id, item.title]));
  const weekdays = ["", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
  const dateTime = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", dateStyle: "medium", timeStyle: "short" });

  return <main className={styles.page}>
    <section className={styles.hero}><div><span>Кабинет родителя</span><h1>{access.child.fullName}</h1><p>Расписание, результаты, прогресс и баланс</p></div>{children.length > 1 && <form className={styles.childSwitch}><label>Выберите ребёнка<select name="student" defaultValue={selectedId}>{children.map((child) => <option value={child.id} key={child.id}>{child.fullName}</option>)}</select></label><button>Показать</button></form>}</section>

    <div className={styles.summaryGrid}><section className={styles.card}><span>Ближайший урок</span>{nextLesson.data ? <><strong>{dateTime.format(new Date(nextLesson.data.starts_at))}</strong><p>{duration(nextLesson.data.starts_at, nextLesson.data.ends_at)} минут</p></> : <strong>Пока не запланирован</strong>}</section><section className={styles.card}><span>Баланс</span><strong className={finance.balanceKzt < 0 ? styles.negative : undefined}>{formatKzt(finance.balanceKzt)}</strong>{finance.balanceKzt < 0 && <p>К оплате: {formatKzt(-finance.balanceKzt)}</p>}</section><section className={styles.card}><span>Тариф</span><strong>{finance.ratePer60Kzt ? formatKzt(finance.ratePer60Kzt) : "Не задан"}</strong><p>за 60 минут</p></section><section className={styles.card}><span>Осталось</span><strong>{finance.remainingLessonEquivalents === null ? "—" : `${formatLessonEquivalents(finance.remainingLessonEquivalents)} урока`}</strong><p>по 60 минут</p></section></div>

    <section className={styles.section}><h2>Текущее расписание</h2>{schedule.data?.length ? <div className={styles.schedule}>{schedule.data.map((slot) => <div key={slot.id}><strong>{weekdays[slot.weekday]}</strong><span>{String(slot.start_time).slice(0,5)} · {slot.duration_minutes} мин</span></div>)}</div> : <p className={styles.muted}>Расписание пока не задано.</p>}</section>

    <section className={styles.section}><h2>Последние результаты тестов</h2>{attemptRows.length ? <div className={styles.results}>{attemptRows.map((attempt) => { const score = Number(attempt.score ?? 0), max = Number(attempt.max_score ?? 0); return <article key={attempt.id}><div><strong>{titleById.get(attempt.assignment_id) ?? "Тест"}</strong><time>{dateTime.format(new Date(attempt.submitted_at))}</time></div><b>{score} / {max}<small>{max > 0 ? `${Math.round(score / max * 100)}%` : "—"}</small></b></article>; })}</div> : <p className={styles.muted}>Завершённых тестов пока нет.</p>}</section>

    <section className={styles.section}><h2>Финансовая история</h2>{finance.entries.length ? <div className={styles.entries}>{finance.entries.map((entry) => <article key={entry.id}><div><strong>{entry.type === "LESSON_CHARGE" ? `Урок${entry.durationMinutes ? ` · ${entry.durationMinutes} мин` : ""}` : entry.type === "PAYMENT" ? "Оплата" : "Корректировка"}</strong><span>{entry.note}</span><time>{dateTime.format(new Date(entry.createdAt))}</time></div><b className={entry.amountKzt < 0 ? styles.negative : undefined}>{entry.amountKzt > 0 ? "+" : ""}{formatKzt(entry.amountKzt)}</b></article>)}</div> : <p className={styles.muted}>Операций пока нет.</p>}</section>

    <section className={styles.progress}><StudentProgressPage data={progress} mode="parent"/></section>
  </main>;
}

function duration(start: string, end: string) { return Math.round((Date.parse(end) - Date.parse(start)) / 60000); }
