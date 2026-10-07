"use client";

import { useMemo, useState, useTransition } from "react";
import MathText from "@/components/tests/math-text";
import { startStudentSkillAttempt, submitStudentSkillAttempt } from "./actions";
import styles from "./skill-practice.module.css";

type AnswerKind = "integer" | "decimal" | "fraction" | "mixed";

type Task = {
  id: string;
  position: number;
  prompt: string;
  difficulty: "BASIC" | "CORE" | "CHALLENGE";
  answerKind: AnswerKind;
};

type AnswerDraft = {
  raw: string;
  whole: string;
  numerator: string;
  denominator: string;
};

type Result = { taskId: string; correct: boolean; expectedAnswer: string };

const labels = { BASIC: "Базовый", CORE: "Основной", CHALLENGE: "Повышенный" } as const;
const emptyDraft = (): AnswerDraft => ({ raw: "", whole: "", numerator: "", denominator: "" });

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

function serializeAnswer(task: Task, draft: AnswerDraft) {
  if (task.answerKind === "fraction") return `${draft.numerator}/${draft.denominator}`;
  if (task.answerKind === "mixed") return `${draft.whole} ${draft.numerator}/${draft.denominator}`;
  return draft.raw.trim();
}

function answerComplete(task: Task, draft: AnswerDraft) {
  if (task.answerKind === "fraction") return Boolean(draft.numerator.trim() && draft.denominator.trim());
  if (task.answerKind === "mixed") return Boolean(draft.whole.trim() && draft.numerator.trim() && draft.denominator.trim());
  return Boolean(draft.raw.trim());
}

export default function SkillPracticeRunner({ topicId, mastered }: { topicId: string; mastered: boolean }) {
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [answers, setAnswers] = useState<Record<string, AnswerDraft>>({});
  const [results, setResults] = useState<Result[]>([]);
  const [notice, setNotice] = useState(mastered ? "Навык уже освоен. Можно пройти ещё раз для повторения." : "");
  const [pending, startTransition] = useTransition();
  const resultMap = useMemo(() => new Map(results.map((item) => [item.taskId, item])), [results]);

  function updateAnswer(taskId: string, patch: Partial<AnswerDraft>) {
    setAnswers((current) => ({
      ...current,
      [taskId]: { ...(current[taskId] ?? emptyDraft()), ...patch },
    }));
  }

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
        answer: serializeAnswer(task, answers[task.id] ?? emptyDraft()),
      })));
      setNotice(result.message);
      if (result.ok && result.results) setResults(result.results);
    });
  }

  function answerInput(task: Task) {
    const draft = answers[task.id] ?? emptyDraft();
    const disabled = pending || results.length > 0;

    if (task.answerKind === "fraction") {
      return <div className={styles.fractionAnswer} aria-label="Ответ в виде дроби">
        <input
          aria-label="Числитель"
          inputMode="text"
          value={draft.numerator}
          disabled={disabled}
          onChange={(event) => updateAnswer(task.id, { numerator: event.target.value })}
          placeholder="3"
        />
        <span className={styles.fractionBar}/>
        <input
          aria-label="Знаменатель"
          inputMode="numeric"
          value={draft.denominator}
          disabled={disabled}
          onChange={(event) => updateAnswer(task.id, { denominator: event.target.value })}
          placeholder="4"
        />
      </div>;
    }

    if (task.answerKind === "mixed") {
      return <div className={styles.mixedAnswer} aria-label="Ответ в виде смешанного числа">
        <input
          className={styles.wholeInput}
          aria-label="Целая часть"
          inputMode="text"
          value={draft.whole}
          disabled={disabled}
          onChange={(event) => updateAnswer(task.id, { whole: event.target.value })}
          placeholder="5"
        />
        <div className={styles.fractionAnswer}>
          <input
            aria-label="Числитель"
            inputMode="numeric"
            value={draft.numerator}
            disabled={disabled}
            onChange={(event) => updateAnswer(task.id, { numerator: event.target.value })}
            placeholder="3"
          />
          <span className={styles.fractionBar}/>
          <input
            aria-label="Знаменатель"
            inputMode="numeric"
            value={draft.denominator}
            disabled={disabled}
            onChange={(event) => updateAnswer(task.id, { denominator: event.target.value })}
            placeholder="4"
          />
        </div>
      </div>;
    }

    return <input
      inputMode={task.answerKind === "decimal" ? "decimal" : "text"}
      value={draft.raw}
      disabled={disabled}
      onChange={(event) => updateAnswer(task.id, { raw: event.target.value })}
      placeholder={task.answerKind === "decimal" ? "Например: 3,5" : "Введите ответ"}
    />;
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
        <div><strong>{results.length ? notice : "Решите все 10 задач"}</strong><span>Для дробей и смешанных чисел появятся отдельные математические поля.</span></div>
        {results.length > 0 && <button onClick={start} disabled={pending}>Новые 10 задач</button>}
      </div>
      <section className={styles.tasks}>
        {tasks.map((task) => {
          const checked = resultMap.get(task.id);
          return <article key={task.id} data-correct={checked?.correct === true || undefined} data-wrong={checked?.correct === false || undefined}>
            <div className={styles.taskHead}><span>№ {task.position}</span><small>{labels[task.difficulty]}</small></div>
            <strong><MathText>{formatSkillMath(task.prompt)}</MathText></strong>
            <div className={styles.answerBlock}>
              <span className={styles.answerLabel}>Ответ</span>
              {answerInput(task)}
            </div>
            {checked && <p>{checked.correct ? "Верно ✓" : <>Неверно. Правильный ответ: <MathText>{formatSkillMath(mixedDisplay(checked.expectedAnswer, task.answerKind))}</MathText></>}</p>}
          </article>;
        })}
      </section>
      {!results.length && <button className={styles.check} onClick={submit} disabled={pending || tasks.some((task) => !answerComplete(task, answers[task.id] ?? emptyDraft()))}>{pending ? "Проверяем…" : "Проверить ответы"}</button>}
      {!results.length && notice && <p className={styles.notice}>{notice}</p>}
    </>}
  </div>;
}
