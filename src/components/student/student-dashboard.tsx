import Link from "next/link";
import { lessonStatusLabels } from "@/lib/lessons/lesson-status";
import type { StudentDashboardData } from "./student-dashboard-types";
import styles from "./student-dashboard.module.css";
import UserAvatar from "@/components/user-avatar";

const zone = "Asia/Almaty";
const weekdays = ["", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const clock = new Intl.DateTimeFormat("ru-RU", { timeZone: zone, hour: "2-digit", minute: "2-digit" });
const lessonDate = new Intl.DateTimeFormat("ru-RU", { timeZone: zone, day: "numeric", month: "long", weekday: "short" });
const nextLessonDate = new Intl.DateTimeFormat("ru-RU", { timeZone: zone, day: "numeric", month: "long", weekday: "long" });
const deadlineDate = new Intl.DateTimeFormat("ru-RU", { timeZone: zone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function endTime(start: string, duration: number) { const [hours, minutes] = start.slice(0, 5).split(":").map(Number); const total = hours * 60 + minutes + duration; return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; }

export default function StudentDashboard({ data }: { data: StudentDashboardData }) {
  return <>
    <section className={styles.header} style={{display:"flex",alignItems:"center",gap:14}}><UserAvatar name={data.fullName} avatarUrl={data.avatarUrl} size={58}/><div><span>{data.dateLabel}</span><h2>{data.greeting}, {data.firstName}</h2></div></section>
    <div className={styles.topGrid}><NextLesson lesson={data.nextLesson}/><WeeklySchedule slots={data.schedule}/></div>
    <PendingTests tests={data.tests}/>
    <RecentLessons lessons={data.lessons}/>
  </>;
}

function NextLesson({ lesson }: { lesson: StudentDashboardData["nextLesson"] }) { return <section className={styles.next}><span>Следующий урок</span>{lesson ? <><h2>{capitalize(nextLessonDate.format(new Date(lesson.startsAt)))}</h2><strong>{clock.format(new Date(lesson.startsAt))}–{clock.format(new Date(lesson.endsAt))}</strong><p>{lesson.happeningNow ? "Урок идёт сейчас" : relativeLessonBadge(lesson.startsAt)}</p></> : <><h2>Пока не запланирован</h2><p>Ближайший урок пока не запланирован.</p></>}</section>; }
function relativeLessonBadge(value: string) { const today = dateKey(new Date()), target = dateKey(new Date(value)); const difference = Math.round((Date.parse(`${target}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000); return difference === 0 ? "Сегодня" : difference === 1 ? "Завтра" : `Через ${difference} дн.`; }
function capitalize(value: string) { return value.charAt(0).toLocaleUpperCase("ru-RU") + value.slice(1); }
function dateKey(value: Date) { return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(value); }
function WeeklySchedule({ slots }: { slots: StudentDashboardData["schedule"] }) { return <section className={styles.schedule}><h2>Недельное расписание</h2>{slots.length ? <div>{slots.map((slot) => <article key={slot.id}><span>{weekdays[slot.weekday]}</span><strong>{slot.startTime.slice(0, 5)}–{endTime(slot.startTime, slot.durationMinutes)}</strong></article>)}</div> : <p>Постоянное расписание пока не установлено.</p>}</section>; }
function PendingTests({ tests }: { tests: StudentDashboardData["tests"] }) { return <section className={styles.block}><div className={styles.blockTitle}><h2>Нужно пройти</h2><span>{tests.length}</span></div>{tests.length ? <div className={styles.tests}>{tests.map((test) => { const disabled = test.action === "EXPIRED"; return <article key={test.id}><div><strong>{test.title}</strong><p className={test.overdue ? styles.warning : test.urgent ? styles.soon : undefined}>{test.deadlineAt ? `${test.overdue ? "Срок истёк" : test.urgent ? "Скоро" : "Дедлайн"}: ${deadlineDate.format(new Date(test.deadlineAt))}` : "Без дедлайна"}</p></div>{disabled ? <button disabled>Срок истёк</button> : <Link href={`/student/tests/${test.id}`}>{test.action === "CONTINUE" ? "Продолжить" : "Открыть"}</Link>}</article>; })}</div> : <p className={styles.empty}>Все назначенные тесты выполнены.</p>}</section>; }
function RecentLessons({ lessons }: { lessons: StudentDashboardData["lessons"] }) { return <section className={styles.block}><div className={styles.blockTitle}><h2>Последние уроки</h2></div>{lessons.length ? <div className={styles.lessons}>{lessons.map((lesson) => <article key={lesson.id}><div><time dateTime={lesson.startsAt}>{lessonDate.format(new Date(lesson.startsAt))} · {clock.format(new Date(lesson.startsAt))}</time><strong className={lesson.status === "ATTENDED" ? undefined : styles.status}>{lesson.status === "NO_SHOW" ? "Урок пропущен" : lesson.status === "LATE_CANCELLED" ? "Поздняя отмена" : lessonStatusLabels[lesson.status]}</strong>{lesson.homework ? <p>ДЗ: {lesson.homework.title}</p> : <p>Домашнее задание не задано</p>}</div>{lesson.homework && <b>{lesson.homework.grade === null ? "Без оценки" : `${lesson.homework.grade}/10`}</b>}</article>)}</div> : <p className={styles.empty}>Прошедших уроков пока нет.</p>}</section>; }
