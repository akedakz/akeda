"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { startSkillGeneratorPreview, submitSkillGeneratorPreview } from "./actions";
import styles from "./skill-preview.module.css";

type Task = {
  id: string;
  position: number;
  prompt: string;
  difficulty: "BASIC" | "CORE" | "CHALLENGE";
};

type Result = { taskId: string; correct: boolean; expectedAnswer: string };

const labels = { BASIC: "Базовый", CORE: "Основной", CHALLENGE: "Повышенный" } as const;

export default function SkillGeneratorPreview({
  programId,
  topicId,
  programName,
  topicTitle,
  backHref,
  rules,
}: {
  programId: string;
  topicId: string;
  programName: string;
  topicTitle: string;
  backHref: string;
  rules: { key: string; count: number; gcdMin: number; gcdMax: number; multiplierMin: number; multiplierMax: number; valueMax: number }[];
}) {
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Result[]>([]);
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();
  const resultMap = useMemo(() => new Map(results.map((item) => [item.taskId, item])), [results]);

  function start() {
    setNotice("");
    startTransition(async () => {
      const result = await startSkillGeneratorPreview(programId, topicId);
      setNotice(result.message);
      if (!result.ok || !result.attemptId || !result.tasks) return;
      setAttemptId(result.attemptId);
      setTasks(result.tasks);
      setAnswers({});
      setResults([]);
    });
  }

  function submit() {
    if (!attemptId) return;
    setNotice("");
    startTransition(async () => {
      const payload = tasks.map((task) => ({ taskId: task.id, answer: answers[task.id] ?? "" }));
      const result = await submitSkillGeneratorPreview(attemptId, payload);
      setNotice(result.message);
      if (result.ok && result.results) setResults(result.results);
    });
  }

  return <main className={styles.page}>
    <Link className={styles.back} href={backHref}>← К программе</Link>
    <header className={styles.header}>
      <span>Прототип навыка · {programName}</span>
      <h1>{topicTitle}</h1>
      <p>Ответ вводится вручную. Правильный ответ хранится только на сервере и появляется после проверки.</p>
    </header>

    <section className={styles.rules}>
      <div>
        <h2>Как работает генератор</h2>
        {rules.length ? <p>Для НОД числа строятся из заранее выбранного общего делителя и взаимно простых множителей, поэтому правильный ответ гарантирован математически.</p> : <p>Каждая попытка собирается из фиксированных шаблонов этого навыка. Диапазоны чисел и ограничения заданы в коде; правильный ответ вычисляется точной арифметикой на сервере, а не ИИ.</p>}
      </div>
      {rules.length > 0 && <div className={styles.ruleGrid}>
        {rules.map((rule) => <article key={rule.key}>
          <strong>{rule.key} · {rule.count} задачи</strong>
          <span>НОД: {rule.gcdMin}–{rule.gcdMax}</span>
          <span>Множители: {rule.multiplierMin}–{rule.multiplierMax}</span>
          <span>Числа не больше {rule.valueMax}</span>
        </article>)}
      </div>}
    </section>

    <div className={styles.toolbar}>
      <button onClick={start} disabled={pending}>{tasks.length ? "Сгенерировать новые 10" : "Сгенерировать 10 задач"}</button>
      {notice && <p data-success={results.length > 0 || undefined}>{notice}</p>}
    </div>

    {tasks.length > 0 && <section className={styles.tasks}>
      {tasks.map((task) => {
        const checked = resultMap.get(task.id);
        return <article key={task.id} data-correct={checked?.correct === true || undefined} data-wrong={checked?.correct === false || undefined}>
          <div className={styles.taskHead}><span>№ {task.position}</span><small>{labels[task.difficulty]}</small></div>
          <strong>{task.prompt}</strong>
          <label>Ответ
            <input
              inputMode="text"
              value={answers[task.id] ?? ""}
              disabled={pending || results.length > 0}
              onChange={(event) => setAnswers((current) => ({ ...current, [task.id]: event.target.value }))}
              placeholder="Например: 12, 3,5 или 5/8"
            />
          </label>
          {checked && <p>{checked.correct ? "Верно ✓" : `Неверно. Правильный ответ: ${checked.expectedAnswer}`}</p>}
        </article>;
      })}
      {!results.length && <button className={styles.check} onClick={submit} disabled={pending || tasks.some((task) => !(answers[task.id] ?? "").trim())}>{pending ? "Проверяем…" : "Проверить 10 ответов"}</button>}
    </section>}
  </main>;
}
