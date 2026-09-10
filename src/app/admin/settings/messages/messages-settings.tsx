"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import BackLink from "@/components/back-link";
import { releasePending, tryAcquirePending } from "@/lib/ui/pending-guard";
import { setSupportStatus } from "./actions";
import styles from "./messages.module.css";

type Message = { id: string; studentId: string; studentName: string; email: string; category: string; message: string; status: "NEW" | "VIEWED" | "RESOLVED"; dateLabel: string; fullDateLabel: string };
const labels = { NEW: "Новое", VIEWED: "Просмотрено", RESOLVED: "Решено" };

export default function MessagesSettings({ messages }: { messages: Message[] }) {
  const [selected, setSelected] = useState<Message | null>(null);
  const [notice, setNotice] = useState("");
  const [pending, start] = useTransition();
  const pendingGuard = useRef(false);

  function close() {
    if (!pendingGuard.current) setSelected(null);
  }

  function change(status: Message["status"]) {
    if (!selected || !tryAcquirePending(pendingGuard)) return;
    const messageId = selected.id;
    start(async () => {
      try {
        const result = await setSupportStatus(messageId, status);
        setNotice(result.message);
        if (result.ok) setSelected((current) => current?.id === messageId ? { ...current, status } : current);
      } catch {
        setNotice("Не удалось изменить статус сообщения.");
      } finally {
        releasePending(pendingGuard);
      }
    });
  }

  return <div className={styles.page}>
    <BackLink href="/admin/settings">Настройки</BackLink>
    <header><span>Настройки</span><h1>Сообщения</h1></header>
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    <section className={styles.list}>{messages.length ? messages.map((item) => <button key={item.id} onClick={() => setSelected(item)}><div><strong>{item.studentName}</strong><span>{item.category}</span><p>{item.message}</p></div><aside><time>{item.dateLabel}</time><b data-status={item.status}>{labels[item.status]}</b></aside></button>) : <p>Сообщений пока нет.</p>}</section>
    {selected && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><article className={styles.modal} role="dialog" aria-modal="true" aria-busy={pending} onKeyDown={(event) => { if (event.key !== "Escape") return; if (pendingGuard.current) { event.preventDefault(); event.stopPropagation(); } else close(); }}>
      <header><div><h2>{selected.category}</h2><time>{selected.fullDateLabel}</time></div><button onClick={close} disabled={pending} aria-label="Закрыть">×</button></header>
      <dl><div><dt>Ученик</dt><dd><Link href={`/admin/students/${selected.studentId}`} aria-disabled={pending} onClick={(event) => { if (pendingGuard.current) event.preventDefault(); }}>{selected.studentName}</Link></dd></div><div><dt>Email</dt><dd>{selected.email}</dd></div><div><dt>Статус</dt><dd>{labels[selected.status]}</dd></div></dl>
      <p className={styles.full}>{selected.message}</p>
      <footer>{selected.status !== "VIEWED" && <button disabled={pending} onClick={() => change("VIEWED")}>{pending ? "Сохраняем…" : "Отметить просмотренным"}</button>}{selected.status !== "RESOLVED" && <button disabled={pending} onClick={() => change("RESOLVED")}>{pending ? "Сохраняем…" : "Отметить решённым"}</button>}{selected.status !== "NEW" && <button disabled={pending} onClick={() => change("NEW")}>{pending ? "Сохраняем…" : "Вернуть в новые"}</button>}</footer>
    </article></div>}
  </div>;
}
