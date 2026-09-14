"use client";

import { useRef, useState, useTransition } from "react";
import { addStudentPayment, createParentAndLink, linkExistingParent, setStudentFinanceRate, unlinkParent } from "@/app/admin/students/[id]/parent-finance-actions";
import { formatKzt, formatLessonEquivalents, type StudentFinanceSummary } from "@/lib/finance/types";
import styles from "./student-parent-finance-panel.module.css";

type ParentOption = { id: string; fullName: string; email: string | null };

export default function StudentParentFinancePanel({ studentId, parents, currentParent, finance }: { studentId: string; parents: ParentOption[]; currentParent: ParentOption | null; finance: StudentFinanceSummary }) {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState("");
  const paymentOperationKey = useRef<string | null>(null);
  const run = (action: () => Promise<{ ok: boolean; message: string }>, onSuccess?: () => void) => startTransition(async () => { const result = await action(); setNotice(result.message); if (result.ok) onSuccess?.(); });
  const submit = (event: React.FormEvent<HTMLFormElement>, action: (data: FormData) => Promise<{ ok: boolean; message: string }>, onSuccess?: () => void) => { event.preventDefault(); const form = event.currentTarget; run(() => action(new FormData(form)), () => { form.reset(); onSuccess?.(); }); };
  const submitPayment = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = event.currentTarget; paymentOperationKey.current ??= crypto.randomUUID(); const data = new FormData(form); data.set("operationKey", paymentOperationKey.current); run(() => addStudentPayment(studentId, data), () => { form.reset(); paymentOperationKey.current = null; }); };
  const negative = finance.balanceKzt < 0;

  return <section className={styles.panel} aria-labelledby="parent-finance-title">
    <header><div><h2 id="parent-finance-title">Родитель и оплата</h2><p>Доступ родителя и новый виртуальный баланс ученика</p></div></header>
    {notice && <p className={styles.notice} role="status">{notice}</p>}

    <div className={styles.grid}>
      <div className={styles.card}><h3>Родитель</h3>
        {currentParent ? <><dl><div><dt>Имя</dt><dd>{currentParent.fullName}</dd></div><div><dt>Email</dt><dd>{currentParent.email ?? "Не указан"}</dd></div></dl><button className={styles.secondary} disabled={pending} onClick={() => run(() => unlinkParent(studentId))}>Отвязать родителя</button></> : <>
          <p>Родитель пока не привязан.</p>
          <form onSubmit={(event) => submit(event, (data) => linkExistingParent(studentId, data))}><label>Существующий родитель<select name="parentId" required defaultValue="" disabled={pending}><option value="" disabled>Выберите родителя</option>{parents.map((parent) => <option value={parent.id} key={parent.id}>{parent.fullName}{parent.email ? ` · ${parent.email}` : ""}</option>)}</select></label><button disabled={pending || parents.length === 0}>Привязать родителя</button></form>
        </>}
        {!currentParent && <details><summary>Создать нового родителя</summary><form onSubmit={(event) => submit(event, (data) => createParentAndLink(studentId, data))}><label>Имя<input name="fullName" maxLength={120} required disabled={pending}/></label><label>Email<input name="email" type="email" required disabled={pending}/></label><label>Временный пароль<input name="password" type="password" minLength={8} autoComplete="new-password" required disabled={pending}/></label><button disabled={pending}>Создать и привязать</button></form></details>}
      </div>

      <div className={styles.card}><h3>Баланс</h3><div className={styles.metrics}><div><span>Баланс</span><strong className={negative ? styles.negative : undefined}>{formatKzt(finance.balanceKzt)}</strong></div><div><span>Тариф</span><strong>{finance.ratePer60Kzt ? `${formatKzt(finance.ratePer60Kzt)} / 60 мин` : "Не задан"}</strong></div><div><span>Осталось</span><strong>{finance.remainingLessonEquivalents === null ? "—" : `${formatLessonEquivalents(finance.remainingLessonEquivalents)} урока`}</strong><small>по 60 минут</small></div>{negative && <div><span>К оплате</span><strong className={styles.negative}>{formatKzt(-finance.balanceKzt)}</strong></div>}</div>
        <form onSubmit={(event) => submit(event, (data) => setStudentFinanceRate(studentId, data))}><label>Тариф за 60 минут, ₸<input name="rate" type="number" min={1} step={1} defaultValue={finance.ratePer60Kzt ?? ""} required disabled={pending}/></label><button disabled={pending}>Сохранить тариф</button></form>
        <form onSubmit={submitPayment}><label>Сумма оплаты, ₸<input name="amount" type="number" min={1} step={1} required disabled={pending}/></label><label>Комментарий<input name="note" maxLength={500} placeholder="Например, Kaspi" disabled={pending}/></label><button disabled={pending}>Добавить оплату</button></form>
      </div>
    </div>

    <div className={styles.history}><h3>Последние операции</h3>{finance.entries.length ? <ul>{finance.entries.map((entry) => <li key={entry.id}><div><strong>{entry.type === "LESSON_CHARGE" ? `Урок${entry.durationMinutes ? ` · ${entry.durationMinutes} мин` : ""}` : entry.type === "PAYMENT" ? "Оплата" : "Корректировка"}</strong><span>{entry.note}</span><time>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(new Date(entry.createdAt))}</time></div><b className={entry.amountKzt < 0 ? styles.negative : undefined}>{entry.amountKzt > 0 ? "+" : ""}{formatKzt(entry.amountKzt)}</b></li>)}</ul> : <p>Операций пока нет.</p>}</div>
  </section>;
}
