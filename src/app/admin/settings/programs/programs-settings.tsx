"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import BackLink from "@/components/back-link";
import { archiveProgram, createProgram } from "./actions";
import styles from "../settings-list.module.css";

type Program = {
  id: string;
  name: string;
  createdLabel: string;
  studentCount: number;
  topicCount: number;
};

export default function ProgramsSettings({ programs }: { programs: Program[] }) {
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState<Program | null>(null);
  const [pending, start] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    start(async () => {
      const result = await createProgram(new FormData(form));
      setMessage(result.message);
      if (result.ok) form.reset();
    });
  }

  return (
    <div className={styles.page}>
      <BackLink href="/admin/settings">Настройки</BackLink>
      <header>
        <span>Настройки</span>
        <h1>Программы</h1>
        <p>Создайте программу, добавьте темы в нужном порядке и назначайте её ученикам.</p>
      </header>

      <form className={styles.create} onSubmit={submit}>
        <input name="name" maxLength={100} placeholder="Название программы" required />
        <button disabled={pending}>{pending ? "Создаём…" : "Создать"}</button>
      </form>

      {message && <p className={styles.notice}>{message}</p>}

      <section className={styles.list}>
        {programs.length ? programs.map((program) => (
          <article key={program.id}>
            <div>
              <strong>{program.name}</strong>
              <small>
                Тем: {program.topicCount} · Учеников: {program.studentCount} · Создана {program.createdLabel}
              </small>
            </div>
            <div className={styles.rowActions}>
              <Link href={`/admin/settings/programs/${program.id}`}>Открыть</Link>
              <button onClick={() => setTarget(program)}>Удалить</button>
            </div>
          </article>
        )) : <p>Активных программ пока нет.</p>}
      </section>

      {target && (
        <div className={styles.backdrop}>
          <div className={styles.modal} role="dialog" aria-modal="true">
            <h2>Архивировать программу?</h2>
            <p>«{target.name}» исчезнет из нового выбора, но сохранится у назначенных учеников.</p>
            <div>
              <button onClick={() => setTarget(null)}>Отмена</button>
              <button
                disabled={pending}
                onClick={() => start(async () => {
                  const result = await archiveProgram(target.id);
                  setMessage(result.message);
                  setTarget(null);
                })}
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
