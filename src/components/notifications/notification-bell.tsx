"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getLatestUnreadNotifications, getUnreadNotificationCount, markAllNotificationsRead, markNotificationRead } from "@/app/notification-actions";
import type { UnreadNotification } from "@/lib/notifications/notifications";
import styles from "./notification-bell.module.css";

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  if (hours < 48) return "вчера";
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit" }).format(new Date(value));
}

function BellIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export default function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<UnreadNotification[] | null>(null);
  const [count, setCount] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const countVersion = useRef(0);

  useEffect(() => {
    let active = true;
    const version = countVersion.current;
    void getUnreadNotificationCount().then((result) => {
      if (active && result.ok && version === countVersion.current) setCount(result.count);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [open]);

  async function loadList() {
    if (listLoading) return;
    setListLoading(true); setError("");
    const result = await getLatestUnreadNotifications();
    setListLoading(false);
    if (!result.ok) { setError(result.message); return; }
    setItems(result.notifications);
    setCount((current) => Math.max(current, result.notifications.length));
  }

  function read(id: string, href?: string) {
    if (pending) return;
    setBusyId(id); setError("");
    startTransition(async () => {
      const result = await markNotificationRead(id);
      setBusyId(null);
      if (!result.ok) { setError(result.message); return; }
      countVersion.current += 1;
      setItems((current) => current?.filter((item) => item.id !== id) ?? current);
      setCount((current) => Math.max(0, current - 1));
      if (href) { setOpen(false); router.push(href); }
    });
  }

  function readAll() {
    if (pending || count === 0) return;
    setBusyId("all"); setError("");
    startTransition(async () => {
      const result = await markAllNotificationsRead();
      setBusyId(null);
      if (!result.ok) { setError(result.message); return; }
      countVersion.current += 1;
      setItems([]); setCount(0);
    });
  }

  return <div className={styles.root} ref={root}>
    <button ref={trigger} className={styles.bell} type="button" aria-label={count ? `Уведомления: ${count} новых` : "Уведомления"} aria-expanded={open} aria-haspopup="dialog" onClick={() => { const next = !open; setOpen(next); setError(""); if (next && items === null) void loadList(); }}>
      <BellIcon/>{count > 0 && <span>{count > 99 ? "99+" : count}</span>}
    </button>
    {open && <section className={styles.popover} role="dialog" aria-label="Уведомления">
      <header><h2>Уведомления</h2>{count > 0 && <button type="button" disabled={pending} onClick={readAll}>{busyId === "all" ? "Читаем…" : "Прочитать все"}</button>}</header>
      {listLoading ? <p className={styles.loading} role="status">Загружаем уведомления…</p> : error && items === null ? <div className={styles.loadError} role="alert"><p>{error}</p><button type="button" onClick={() => void loadList()}>Повторить</button></div> : items?.length ? <div className={styles.list}>{items.map((item) => <article key={item.id}>
        <div><strong>{item.title}</strong>{item.message && <p>{item.message}</p>}<time dateTime={item.createdAt}>{relativeTime(item.createdAt)}</time></div>
        <footer><button type="button" disabled={pending} onClick={() => read(item.id, item.href)}>Открыть</button><button className={styles.check} type="button" disabled={pending} aria-label="Отметить как прочитанное" title="Отметить как прочитанное" onClick={() => read(item.id)}>{busyId === item.id ? "…" : "✓"}</button></footer>
      </article>)}</div> : <p className={styles.empty}>Новых уведомлений нет</p>}
      {error && items !== null && <p className={styles.error} role="status">{error}</p>}
      {items && count > items.length && <small className={styles.more}>Показаны последние {items.length} из {count}</small>}
    </section>}
  </div>;
}
