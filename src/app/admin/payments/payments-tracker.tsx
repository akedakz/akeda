"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addWeeklyPaymentRow, copyPreviousWeek, deleteWeeklyPaymentRow, saveWeeklyPaymentRow, setWeeklyPaymentPaid } from "./actions";
import { formatKzt, type WeeklyPaymentRow, type WeeklyPaymentsDashboard } from "@/lib/payments/types";
import { addDays } from "@/lib/payments/week";
import { releasePending, tryAcquirePending } from "@/lib/ui/pending-guard";
import styles from "./payments.module.css";

const rangeFormatter = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
const shortDate = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "Asia/Almaty" });
const subjects = ["Физика", "Математика", "Физика и математика", "Другое"];
type Draft = { studentName: string; subject: string; price: string; lessons: string; notes: string };
type SaveStatus = "idle" | "saving" | "saved" | "error";

function rangeLabel(start: string) {
  const end = addDays(start, 6);
  return `${rangeFormatter.format(new Date(`${start}T00:00:00Z`))} — ${rangeFormatter.format(new Date(`${end}T00:00:00Z`))}`;
}

function draftRow(): WeeklyPaymentRow {
  return { id: `draft-${crypto.randomUUID()}`, student_name: "", subject: "", price_per_lesson_kzt: 0, lessons_count: 0, amount_due_kzt: 0, paid: false, paid_at: null, notes: null, sort_order: 1000000 };
}

export default function PaymentsTracker({ weekStart, currentWeek, initial }: { weekStart: string; currentWeek: string; initial: WeeklyPaymentsDashboard }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial.rows);
  const [error, setError] = useState("");
  const [studentsOpen, setStudentsOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const totals = useMemo(() => {
    const due = rows.reduce((sum, row) => sum + Number(row.amount_due_kzt), 0);
    const received = rows.reduce((sum, row) => sum + (row.paid ? Number(row.amount_due_kzt) : 0), 0);
    return { due, received, remaining: due - received, percentage: due ? Math.round(received * 100 / due) : 0 };
  }, [rows]);

  function copy() {
    setError("");
    startTransition(async () => {
      const result = await copyPreviousWeek(weekStart);
      if (!result.ok) setError(result.message);
      else router.refresh();
    });
  }

  function addDraft() {
    setRows(current => [...current, draftRow()]);
  }

  function setPaid(id: string, paid: boolean, paidAt: string | null) {
    setRows(current => current.map(item => item.id === id ? { ...item, paid, paid_at: paidAt } : item));
  }

  return <div className={styles.page}>
    <section className={styles.weekBar}>
      <div className={styles.weekNav}><Link aria-label="Предыдущая неделя" href={`/admin/payments?week=${addDays(weekStart, -7)}`}>←</Link><strong>{rangeLabel(weekStart)}</strong><Link aria-label="Следующая неделя" href={`/admin/payments?week=${addDays(weekStart, 7)}`}>→</Link></div>
      <div className={styles.weekTools}><Link className={styles.todayButton} data-current={weekStart === currentWeek || undefined} href={`/admin/payments?week=${currentWeek}`}>Сегодня</Link><button className={styles.studentsButton} onClick={() => setStudentsOpen(true)}>Ученики</button></div>
    </section>

    <section className={styles.summaryCards}>
      <Summary label="Всего" value={totals.due}/>
      <Summary label="Оплачено" value={totals.received} secondary={`${totals.percentage}%`} tone="positive"/>
      <Summary label="Не оплачено" value={totals.remaining} tone="warning"/>
    </section>

    {error && <p className={styles.errorNotice} role="alert">{error}</p>}
    <section className={styles.tableCard} aria-busy={pending}>
      <div className={styles.tableScroll}>
        <div className={styles.tableHead}><span>Ученик</span><span>Предмет</span><span>Цена за урок</span><span>Уроки</span><span>Сумма</span><span>Оплачено</span><span>Заметка</span><span/></div>
        <div className={styles.rows}>{rows.map(row => <PaymentRow key={row.id} weekStart={weekStart} row={row} setPaid={setPaid} onError={setError} onCreated={(draftId, created) => setRows(current => current.map(item => item.id === draftId ? created : item))} onChanged={(id, changes) => setRows(current => current.map(item => item.id === id ? { ...item, ...changes } : item))} onDeleted={id => setRows(current => current.filter(item => item.id !== id))}/>)}</div>
        <datalist id="payment-subjects">{subjects.map(subject => <option key={subject} value={subject}/>)}</datalist>
      </div>
      {!rows.length && <div className={styles.empty}><strong>На этой неделе строк пока нет</strong><span>Добавьте строку вручную или скопируйте прошлую неделю.</span></div>}
      <div className={styles.tableActions}><button className={styles.primary} onClick={addDraft}>+ Добавить</button><button disabled={pending || rows.length > 0} title={rows.length ? "Копирование доступно только для пустой недели" : undefined} onClick={copy}>Скопировать прошлую неделю</button></div>
    </section>

    <section className={styles.statistics}><h2>Поступления</h2><div><Summary label="Неделя" value={Number(initial.actual_received.week_kzt)}/><Summary label="Месяц" value={Number(initial.actual_received.month_kzt)}/><Summary label="Год" value={Number(initial.actual_received.year_kzt)}/></div></section>
    {studentsOpen && <StudentsModal students={initial.students} close={() => setStudentsOpen(false)}/>}
  </div>;
}

function Summary({ label, value, secondary, tone }: { label: string; value: number; secondary?: string; tone?: "positive" | "warning" }) { return <article data-tone={tone}><span>{label}</span><strong>{formatKzt(value)}{secondary && <small> · {secondary}</small>}</strong></article>; }

function PaymentRow({ weekStart, row, setPaid, onError, onCreated, onChanged, onDeleted }: { weekStart: string; row: WeeklyPaymentRow; setPaid: (id: string, paid: boolean, paidAt: string | null) => void; onError: (message: string) => void; onCreated: (draftId: string, row: WeeklyPaymentRow) => void; onChanged: (id: string, changes: Partial<WeeklyPaymentRow>) => void; onDeleted: (id: string) => void }) {
  const router = useRouter();
  const isDraft = row.id.startsWith("draft-");
  const [draft, setDraft] = useState<Draft>({ studentName: row.student_name, subject: row.subject, price: isDraft ? "" : String(row.price_per_lesson_kzt), lessons: isDraft ? "" : String(row.lessons_count), notes: row.notes ?? "" });
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [paidPending, setPaidPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const latest = useRef(draft), revision = useRef(0), savedRevision = useRef(0), running = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | null>(null), rowId = useRef(row.id), parentId = useRef(row.id), createdBase = useRef<WeeklyPaymentRow | null>(null);
  const paidGuard = useRef(false), deleteGuard = useRef(false), paidRevision = useRef(0);
  const amount = (Number(draft.price) || 0) * (Number(draft.lessons) || 0);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function valid(value: Draft) { const price = Number(value.price || 0), lessons = Number(value.lessons || 0); return Boolean(value.studentName.trim() && value.subject.trim() && Number.isInteger(price) && price >= 0 && price <= 10000000 && Number.isInteger(lessons) && lessons >= 0 && lessons <= 1000 && value.notes.trim().length <= 500); }

  function schedule(delay = 650) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void persist(); }, delay);
  }

  function change(next: Draft) {
    setDraft(next); latest.current = next; revision.current += 1; setStatus("idle"); schedule();
    onChanged(parentId.current, { student_name: next.studentName, subject: next.subject, price_per_lesson_kzt: Number(next.price) || 0, lessons_count: Number(next.lessons) || 0, amount_due_kzt: (Number(next.price) || 0) * (Number(next.lessons) || 0), notes: next.notes || null });
  }

  async function persist() {
    if (running.current || paidGuard.current || deleteGuard.current || revision.current === savedRevision.current || !valid(latest.current)) return;
    running.current = true; setStatus("saving");
    const capturedRevision = revision.current, value = latest.current;
    const input = { studentName: value.studentName, subject: value.subject, price: Number(value.price || 0), lessons: Number(value.lessons || 0), notes: value.notes };
    const result = rowId.current.startsWith("draft-") ? await addWeeklyPaymentRow(weekStart, input) : await saveWeeklyPaymentRow(rowId.current, input);
    if (result.ok) {
      savedRevision.current = capturedRevision; setStatus("saved");
      const created = "row" in result ? result.row as WeeklyPaymentRow | undefined : undefined;
      if (created) { rowId.current = created.id; createdBase.current = created; }
      if (createdBase.current && revision.current === savedRevision.current) onCreated(parentId.current, { ...createdBase.current, id: rowId.current, student_name: latest.current.studentName.trim(), subject: latest.current.subject.trim(), price_per_lesson_kzt: Number(latest.current.price || 0), lessons_count: Number(latest.current.lessons || 0), amount_due_kzt: (Number(latest.current.price) || 0) * (Number(latest.current.lessons) || 0), notes: latest.current.notes.trim() || null });
      if (revision.current === savedRevision.current) router.refresh();
    } else setStatus("error");
    running.current = false;
    if (revision.current > savedRevision.current && result.ok) schedule(0);
  }

  async function togglePaid(paid: boolean) {
    if (running.current || deleteGuard.current || !tryAcquirePending(paidGuard)) return;
    const operation = ++paidRevision.current;
    const id = rowId.current;
    const previous = { paid: row.paid, paidAt: row.paid_at };
    const paidAt = paid ? new Date().toISOString() : null;
    setPaidPending(true);
    onError("");
    setPaid(id, paid, paidAt);
    try {
      const result = await setWeeklyPaymentPaid(id, paid);
      if (operation !== paidRevision.current) return;
      if (!result.ok) {
        setPaid(id, previous.paid, previous.paidAt);
        onError(result.message);
      } else router.refresh();
    } catch {
      if (operation === paidRevision.current) {
        setPaid(id, previous.paid, previous.paidAt);
        onError("Не удалось изменить отметку оплаты.");
      }
    } finally {
      if (operation === paidRevision.current) setPaidPending(false);
      releasePending(paidGuard);
      if (revision.current > savedRevision.current) schedule(0);
    }
  }

  async function remove() {
    if (running.current || paidGuard.current || deleteGuard.current) return;
    if (!confirm(`Удалить строку «${draft.studentName || "без имени"}»?`)) return;
    if (rowId.current.startsWith("draft-")) { onDeleted(rowId.current); return; }
    if (!tryAcquirePending(deleteGuard)) return;
    if (timer.current) clearTimeout(timer.current);
    setDeleting(true);
    setStatus("idle");
    onError("");
    try {
      const result = await deleteWeeklyPaymentRow(rowId.current);
      if (result.ok) onDeleted(rowId.current);
      else { setStatus("error"); onError(result.message); }
    } catch {
      setStatus("error");
      onError("Не удалось удалить строку.");
    } finally {
      releasePending(deleteGuard);
      setDeleting(false);
      if (revision.current > savedRevision.current) schedule(0);
    }
  }

  return <div className={styles.paymentRow} data-paid={row.paid || undefined} data-deleting={deleting || undefined} aria-busy={deleting || paidPending}>
    <input aria-label="Имя ученика" value={draft.studentName} maxLength={120} placeholder="Имя ученика…" disabled={deleting} onBlur={() => schedule(0)} onChange={event => change({ ...draft, studentName: event.target.value })}/>
    <input aria-label="Предмет" list="payment-subjects" value={draft.subject} maxLength={120} placeholder="Предмет…" disabled={deleting} onBlur={() => schedule(0)} onChange={event => change({ ...draft, subject: event.target.value })}/>
    <input aria-label="Цена урока" type="number" min={0} max={10000000} value={draft.price} placeholder="0" disabled={deleting} onBlur={() => schedule(0)} onChange={event => change({ ...draft, price: event.target.value })}/>
    <input aria-label="Количество уроков" type="number" min={0} max={1000} value={draft.lessons} placeholder="0" disabled={deleting} onBlur={() => schedule(0)} onChange={event => change({ ...draft, lessons: event.target.value })}/>
    <strong data-paid={row.paid || undefined}>{formatKzt(amount)}</strong>
    <label className={styles.paidBox}><input aria-label="Оплачено" type="checkbox" checked={row.paid} disabled={isDraft || deleting || paidPending || status === "saving"} onChange={event => void togglePaid(event.target.checked)}/><span aria-hidden>✓</span></label>
    <input aria-label="Заметка" value={draft.notes} maxLength={500} placeholder="Заметка…" disabled={deleting} onBlur={() => schedule(0)} onChange={event => change({ ...draft, notes: event.target.value })}/>
    <div className={styles.rowMeta}><small data-status={deleting ? "saving" : status}>{deleting ? "Удаляем…" : paidPending ? "Сохраняем…" : status === "saving" ? "Сохранение…" : status === "saved" ? "Сохранено" : status === "error" ? "Ошибка" : ""}</small><button type="button" title={deleting ? "Удаляем строку" : "Удалить строку"} aria-label={deleting ? "Удаляем строку" : "Удалить строку"} disabled={deleting || paidPending || status === "saving"} onClick={remove}>{deleting ? "…" : "•••"}</button></div>
  </div>;
}

function StudentsModal({ students, close }: { students: WeeklyPaymentsDashboard["students"]; close: () => void }) {
  const [query, setQuery] = useState("");
  const filtered = students.filter(student => student.name.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru")));
  return <div className={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="payments-students-title"><div className={styles.modalHead}><h2 id="payments-students-title">Ученики</h2><button onClick={close} aria-label="Закрыть">×</button></div><input className={styles.search} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Поиск по имени"/><div className={styles.studentList}>{filtered.map(student => <article key={student.name.toLocaleLowerCase("ru")}><div><strong>{student.name}</strong><span>Последняя оплата: {shortDate.format(new Date(student.last_paid_at))}</span></div><b>{formatKzt(Number(student.total_paid_kzt))}</b></article>)}{!filtered.length && <p>Оплаченные строки не найдены.</p>}</div></section></div>;
}
