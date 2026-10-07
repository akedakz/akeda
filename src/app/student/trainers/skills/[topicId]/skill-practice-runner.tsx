"use client";

import { useMemo, useState, useTransition } from "react";
import MathText from "@/components/tests/math-text";
import { startStudentSkillAttempt, submitStudentSkillAttempt } from "./actions";
import styles from "./skill-practice.module.css";

type Task = {
  id: string;
  position: number;
  prompt: string;
  difficulty: "BASIC" | "CORE" | "CHALLENGE";
};

type Result = { taskId: string; correct: boolean; expectedAnswer: string };

const labels = { BASIC: "Базовый", CORE: "Основной", CHALLENGE: "Повышенный" } as const;

function formatSkillMath(source: string) {
  if (source.includes("$")) return source;
  return source
    .replace(/(-?\d+)\s+(\d+)\/(\d+)/g, (_match, whole, numerator, denominator) =>
      "$" + whole + "\\frac{" + numerator + "}{" + denominator + "}$")
    .replace(/(-?\d+)\/(\d+)/g, (_match, numerator, denominator) =>
      "$\\frac{" + numerator + "}{" + denominator + "}$");
}

export default function SkillPracticeRunner({ topicId, mastered }: { topicId: string; mastered: boolean }) {
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Result[]>([]);
  const [notice, setNotice] = useState(mastered ? "Навык уже освоен. Можно пройти ещё раз для повторения." : "");
  const [pending, startTransition] = useTransition();
  const resultMap = useMemo(() => new Map(results.map((item) => [item.taskId, item])), [results]);

  function start() {
    setNotice("");
    startTransition(async () => {
      const result = await startStudentSkillAttempt(topicId);
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
      const result = await submitStudentSkillAttempt(attemptId, tasks.map((task) => ({
        taskId: task.id,
        answer: answers[task.id] ?? "",
      })));
      setNotice(result.message);
      if (result.ok && result.results) setResults(result.results);
    });
  }

  return <div className={styles.wrap}>
    {!tasks.length && <section className={styles.intro}>
      <span>{mastered ? "Освоен ✓" : "В процессе"}</span>
      <h2>10 задач с ручным ответом</h2>
      <p>Чтобы освоить навык, нужно ответить правильно на все 10 заданий. В каждой новой попытке числа меняются.</p>
      <button onClick={start} disabled={pending}>{pending ? "Генерируем…" : mastered ? "Пройти ещё раз" : "Начать тренировку"}</button>
      {notice && <p className={styles.notice}>{notice}</p>}
    </section>}

    {tasks.length > 0 && <>
      <div className={styles.topbar}>
        <div><strong>{results.length ? notice : "Решите все 10 задач"}</strong><span>Можно вводить целое число, десятичную дробь или обычную дробь.</span></div>
        {results.length > 0 && <button onClick={start} disabled={pending}>Новые 10 задач</button>}
      </div>
      <section className={styles.tasks}>
        {tasks.map((task) => {
          const checked = resultMap.get(task.id);
          return <article key={task.id} data-correct={checked?.correct === true || undefined} data-wrong={checked?.correct === false || undefined}>
            <div className={styles.taskHead}><span>№ {task.position}</span><small>{labels[task.difficulty]}</small></div>
            <strong><MathText>{formatSkillMath(task.prompt)}</MathText></strong>
            <label>Ответ
              <input
                inputMode="text"
                value={answers[task.id] ?? ""}
                disabled={pending || results.length > 0}
                onChange={(event) => setAnswers((current) => ({ ...current, [task.id]: event.target.value }))}
                placeholder="Например: 12, 3,5 или 5/8"
              />
            </label>
            {checked && <p>{checked.correct ? "Верно ✓" : <>Неверно. Правильный ответ: <MathText>{formatSkillMath(checked.expectedAnswer)}</MathText></>}</p>}
          </article>;
        })}
      </section>
      {!results.length && <button className={styles.check} onClick={submit} disabled={pending || tasks.some((task) => !(answers[task.id] ?? "").trim())}>{pending ? "Проверяем…" : "Проверить ответы"}</button>}
      {!results.length && notice && <p className={styles.notice}>{notice}</p>}
    </>}
  </div>;
}
