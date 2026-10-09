"use client";

import { useMemo, useState, useTransition } from "react";
import SkillAnswerInput, { skillAnswerComplete } from "@/components/students/skill-answer-input";
import type { SkillAnswerMeta, SkillAnswerKind } from "@/lib/programs/skill-answer-policy";
import MathText from "@/components/tests/math-text";
import { startStudentSkillAttempt, submitStudentSkillAttempt } from "./actions";
import styles from "./skill-practice.module.css";

type AnswerKind = SkillAnswerKind;

type Task = SkillAnswerMeta & {
  id: string;
  position: number;
  prompt: string;
  difficulty: "BASIC" | "CORE" | "CHALLENGE";
  answerKind: AnswerKind;
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

function mixedDisplay(source: string, kind: AnswerKind) {
  if (kind !== "mixed") return source;
  const match = source.match(/^(-?\d+)\/(\d+)$/);
  if (!match) return source;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) return source;
  const absolute = Math.abs(numerator);
  const whole = Math.floor(absolute / denominator);
  const remainder = absolute % denominator;
  if (!whole || !remainder) return source;
  return (numerator < 0 ? "-" : "") + whole + " " + remainder + "/" + denominator;
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
      <h2>Задания с ручным ответом</h2>
      <p>Чтобы освоить навык, нужно ответить правильно на все задания набора. В каждой новой попытке числа меняются.</p>
      <button onClick={start} disabled={pending}>{pending ? "Генерируем…" : mastered ? "Пройти ещё раз" : "Начать тренировку"}</button>
      {notice && <p className={styles.notice}>{notice}</p>}
    </section>}

    {tasks.length > 0 && <>
      <div className={styles.topbar}>
        <div><strong>{results.length ? notice : `Решите все ${tasks.length} задач`}</strong><span>Соблюдайте форму ответа, указанную под заданием.</span></div>
        {results.length > 0 && <button onClick={start} disabled={pending}>Новый набор задач</button>}
      </div>
      <section className={styles.tasks}>
        {tasks.map((task) => {
          const checked = resultMap.get(task.id);
          return <article key={task.id} data-correct={checked?.correct === true || undefined} data-wrong={checked?.correct === false || undefined}>
            <div className={styles.taskHead}><span>№ {task.position}</span><small>{labels[task.difficulty]}</small></div>
            <strong><MathText>{formatSkillMath(task.prompt)}</MathText></strong>
            <div className={styles.answerBlock}>
              <span className={styles.answerLabel}>Ответ</span>
              <SkillAnswerInput {...task} id={task.id} value={answers[task.id] ?? ""} disabled={pending || results.length > 0}
                onChange={value => setAnswers(current => ({ ...current, [task.id]: value }))} />
            </div>
            {checked && <p>{checked.correct ? "Верно ✓" : <>Неверно. Правильный ответ: <MathText>{formatSkillMath(mixedDisplay(checked.expectedAnswer, task.answerKind))}</MathText></>}</p>}
          </article>;
        })}
      </section>
      {!results.length && <button className={styles.check} onClick={submit} disabled={pending || tasks.some((task) => !skillAnswerComplete(answers[task.id] ?? "", task.answerKind))}>{pending ? "Проверяем…" : "Проверить ответы"}</button>}
      {!results.length && notice && <p className={styles.notice}>{notice}</p>}
    </>}
  </div>;
}
