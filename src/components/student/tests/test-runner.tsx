"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { finalizeExpiredTestAttempt, saveTestAnswer, submitTestAttempt } from "@/app/student/tests/actions";
import MathText from "@/components/tests/math-text";
import QuestionImage from "@/components/tests/question-image";
import { trackAttemptSave } from "./test-answer-save-coordinator";
import { answerIsFilled } from "@/lib/tests/grade-student-attempt";
import { AnswerAutosave, answerConflictMessage, type AnswerSaveState } from "@/lib/tests/answer-autosave";
import type {
  SafeStudentTest,
  StudentAnswer,
} from "@/lib/tests/student-test-types";
import styles from "./test-runner.module.css";

function questionWord(count: number) {
  const lastTwo = count % 100;
  const last = count % 10;

  if (lastTwo >= 11 && lastTwo <= 14) return "вопросов";
  if (last === 1) return "вопрос";
  if (last >= 2 && last <= 4) return "вопроса";
  return "вопросов";
}

export default function TestRunner({
  test,
  attemptId,
  initialAnswers,
  initialRevisions = {},
  deadlineAt = null,
  mode = "student",
  onPreviewFinish,
}: {
  test: SafeStudentTest;
  attemptId?: string;
  initialAnswers: Record<string, StudentAnswer>;
  initialRevisions?: Record<string, number>;
  deadlineAt?: string | null;
  mode?: "student" | "preview";
  onPreviewFinish?: (answers: Record<string, StudentAnswer>) => void;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState(initialAnswers);
  const [saveState, setSaveState] = useState<AnswerSaveState>(
    "saved",
  );
  const [confirm, setConfirm] = useState(false);
  const [deadlineReached, setDeadlineReached] = useState(false);
  const [submitting, startTransition] = useTransition();
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [autosave] = useState(() => new AnswerAutosave(
    initialRevisions,
    (key, answer, revision) => saveTestAnswer(attemptId!, key, answer, { expectedRevision: revision }),
    setSaveState,
  ));
  const deadlineFinalizationStarted = useRef(false);
  const preloadedImageUrls = useRef(new Set<string>());
  const imagePreloads = useRef(new Map<string, HTMLImageElement>());
  const question = test.questions[index];
  const answered = test.questions.filter((item) =>
    answerIsFilled(answers[item.key]),
  ).length;

  function persistAnswer(key: string) {
    if (mode !== "student" || !attemptId) return null;
    timers.current.delete(key);
    return trackAttemptSave(attemptId, autosave.persist(key));
  }

  const persistAnswerRef = useRef(persistAnswer);
  useEffect(() => { persistAnswerRef.current = persistAnswer; });

  useEffect(() => {
    const scheduledTimers = timers.current;
    const pendingAnswers = autosave.dirty;
    return () => {
      for (const timeout of scheduledTimers.values()) clearTimeout(timeout);
      scheduledTimers.clear();
      for (const key of pendingAnswers.keys()) persistAnswerRef.current(key);
    };
  }, [attemptId, mode, autosave]);

  useEffect(() => {
    const currentUrl = test.questions[0]?.imageUrl ?? null;
    if (currentUrl) preloadedImageUrls.current.add(currentUrl);
    const urls = [...new Set(test.questions.flatMap((item) => item.imageUrl ? [item.imageUrl] : []))]
      .filter((url) => url !== currentUrl && !preloadedImageUrls.current.has(url));
    for (const url of urls) {
      preloadedImageUrls.current.add(url);
      const image = new window.Image();
      image.decoding = "async";
      image.onload = image.onerror = () => { imagePreloads.current.delete(url); };
      imagePreloads.current.set(url, image);
      image.src = url;
    }
  }, [test.questions]);

  useEffect(() => {
    if (mode !== "student" || !attemptId || !deadlineAt) return;
    const finalize = () => {
      if (deadlineFinalizationStarted.current) return;
      deadlineFinalizationStarted.current = true;
      setDeadlineReached(true);
      setConfirm(false);
      for (const timeout of timers.current.values()) clearTimeout(timeout);
      timers.current.clear();
      setSaveState("saving");
      startTransition(async () => {
        const result = await finalizeExpiredTestAttempt(attemptId, test.assignmentId);
        if (result.finalized) { window.location.reload(); return; }
        if (result.retryAfterMs) {
          deadlineFinalizationStarted.current = false;
          window.setTimeout(finalize, Math.min(result.retryAfterMs, 2_147_000_000));
          return;
        }
        setSaveState("error");
        deadlineFinalizationStarted.current = false;
        window.setTimeout(finalize, 5000);
      });
    };
    const deadlineTime = new Date(deadlineAt).getTime();
    let deadlineTimer: number | null = null;
    const schedule = () => {
      const remaining = deadlineTime - Date.now();
      if (remaining <= 0) { finalize(); return; }
      deadlineTimer = window.setTimeout(schedule, Math.min(remaining, 2_147_000_000));
    };
    schedule();
    return () => { if (deadlineTimer !== null) window.clearTimeout(deadlineTimer); };
  }, [attemptId, deadlineAt, mode, test.assignmentId]);

  function update(answer: StudentAnswer) {
    if (deadlineReached || submitting || autosave.state === "conflict") return;
    const key = question.key;
    setAnswers((current) => ({ ...current, [key]: answer }));
    if (mode === "preview") return;
    autosave.edit(key, answer);
    const currentTimer = timers.current.get(key);
    if (currentTimer) clearTimeout(currentTimer);
    timers.current.set(key, setTimeout(() => { persistAnswer(key); }, 700));
  }

  function submit() {
    if (mode === "preview") {
      onPreviewFinish?.(answers);
      setConfirm(false);
      return;
    }
    startTransition(async () => {
      if (autosave.state === "conflict") { setSaveState("conflict"); setConfirm(false); return; }
      for (const timeout of timers.current.values()) clearTimeout(timeout);
      timers.current.clear();
      setSaveState("saving");
      const flushed = await trackAttemptSave(attemptId!, autosave.flush(answers));
      if (!flushed) {
        setSaveState(autosave.state);
        setConfirm(false);
        return;
      }
      const result = await submitTestAttempt(attemptId!, test.assignmentId, answers);
      if (result.status === "conflict") autosave.markConflict();
      else setSaveState("error");
      setConfirm(false);
    });
  }

  if (!question) return <p>В тесте нет вопросов.</p>;

  return (
    <div className={styles.runner}>
      <header>
        <div>
          <span>Назначенный тест</span>
          <h1>{test.title}</h1>
        </div>
        {mode === "student" && <div className={styles.save} data-state={saveState === "conflict" ? "error" : saveState}>
          {saveState === "saving"
            ? "Сохранение…"
            : saveState === "conflict"
              ? "Ответ не сохранён"
            : saveState === "error"
              ? "Не удалось сохранить"
              : "Сохранено"}
        </div>}
      </header>

      <div className={styles.layout}>
        <aside>
          <strong>
            Вопрос {index + 1} из {test.questions.length}
          </strong>
          <p>
            Ответов: {answered} из {test.questions.length}
          </p>
          <nav aria-label="Вопросы теста">
            {test.questions.map((item, itemIndex) => (
              <button
                key={item.key}
                aria-current={itemIndex === index ? "step" : undefined}
                data-answered={answerIsFilled(answers[item.key])}
                onClick={() => setIndex(itemIndex)}
              >
                {itemIndex + 1}
              </button>
            ))}
          </nav>
        </aside>

        <main>
          <section className={styles.question}>
            <div className={styles.questionHead}>
              <span>{index + 1}</span>
              <div>
                <h2><MathText>{question.prompt || "Вопрос с изображением"}</MathText></h2>
                <p>
                  {question.points} балл(а)
                  {question.required ? " · обязательный" : ""}
                </p>
              </div>
            </div>
            {question.imageUrl && (
              <QuestionImage src={question.imageUrl} loading="eager" fetchPriority="high" />
            )}
            <fieldset className={styles.answerLock} disabled={deadlineReached || submitting || saveState === "conflict"}>
              <QuestionAnswerField
                question={question}
                answer={answers[question.key]}
                update={update}
              />
            </fieldset>
          </section>
        </main>
      </div>

      <footer>
        <button
          onClick={() => setIndex((value) => Math.max(0, value - 1))}
          disabled={index === 0 || deadlineReached}
        >
          Назад
        </button>
        {index < test.questions.length - 1 ? (
          <button
            disabled={deadlineReached}
            onClick={() =>
              setIndex((value) =>
                Math.min(test.questions.length - 1, value + 1),
              )
            }
          >
            Далее
          </button>
        ) : (
          <button className={styles.finish} onClick={() => setConfirm(true)} disabled={deadlineReached || saveState === "conflict"}>
            {mode === "preview" ? "Завершить предпросмотр" : "Завершить тест"}
          </button>
        )}
      </footer>

      {mode === "student" && deadlineReached && (
        <p className={styles.deadlineNotice} role="status">Срок истёк. Последние сохранённые ответы отправляются на проверку…</p>
      )}

      {mode === "student" && saveState === "conflict" && <p className={styles.deadlineNotice} role="alert">{answerConflictMessage}</p>}

      {mode === "student" && saveState === "error" && !deadlineReached && (
        <button
          className={styles.retry}
          onClick={() =>
            update(answers[question.key] ?? emptyStudentAnswer(question.type))
          }
        >
          Повторить сохранение
        </button>
      )}

      {confirm && (
        <div
          className={styles.backdrop}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !submitting) {
              setConfirm(false);
            }
          }}
        >
          <div className={styles.modal} role="dialog" aria-modal="true">
            <h2>Завершить тест?</h2>
            <p>
              {answered < test.questions.length
                ? `Вы ответили на ${answered} из ${test.questions.length} ${questionWord(test.questions.length)}. `
                : ""}
              После отправки изменить ответы будет нельзя.
            </p>
            <div>
              <button onClick={() => setConfirm(false)} disabled={submitting}>
                Вернуться
              </button>
              <button onClick={submit} disabled={submitting}>
                {submitting ? "Отправляем…" : "Завершить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function emptyStudentAnswer(
  type: SafeStudentTest["questions"][number]["type"],
): StudentAnswer {
  if (type === "SINGLE_CHOICE") return { type, optionKey: null };
  if (type === "MULTIPLE_CHOICE") return { type, optionKeys: [] };
  if (type === "NUMERIC") return { type, value: null };
  if (type === "MATCHING") return { type, matches: {} };
  return { type, parts: {} };
}

export function QuestionAnswerField({
  question,
  answer,
  update,
}: {
  question: SafeStudentTest["questions"][number];
  answer?: StudentAnswer;
  update: (answer: StudentAnswer) => void;
}) {
  if (question.type === "NUMERIC") {
    return (
      <NumericField
        key={question.key}
        answer={answer?.type === "NUMERIC" ? answer : undefined}
        update={update}
      />
    );
  }

  if (question.type === "MATCHING") {
    const matches = answer?.type === "MATCHING" ? answer.matches : {};
    const selected = new Set(Object.values(matches));
    return <div className={styles.matching}>{question.matching.leftItems.map((item) => <fieldset key={item.key}><legend><b>{item.label}.</b> <MathText>{item.text}</MathText></legend><div>{question.matching.options.map((option) => { const disabled = !question.matching.allowOptionReuse && selected.has(option.key) && matches[item.key] !== option.key; return <label key={option.key} data-disabled={disabled}><input type="radio" name={`match-${question.key}-${item.key}`} checked={matches[item.key] === option.key} disabled={disabled} onChange={() => update({ type: "MATCHING", matches: { ...matches, [item.key]: option.key } })}/><b>{option.label}.</b><MathText>{option.text}</MathText></label>; })}</div></fieldset>)}</div>;
  }
  if (question.type === "MULTI_PART") {
    const parts = answer?.type === "MULTI_PART" ? answer.parts : {};
    return <div className={styles.multiPart}>{question.multiPart.parts.map((part) => <section key={part.key}><header><b>{part.label})</b><MathText>{part.prompt}</MathText><small>{part.points} балл(а)</small></header><BaseAnswerField type={part.type} questionKey={`${question.key}-${part.key}`} options={part.options} answer={parts[part.key]} update={(partAnswer) => update({ type: "MULTI_PART", parts: { ...parts, [part.key]: partAnswer } })} /></section>)}</div>;
  }

  const selected = answer?.type === "MULTIPLE_CHOICE" ? answer.optionKeys : [];
  return (
    <div className={styles.options}>
      {question.options.map((option) => (
        <label key={option.key}>
          <input
            type={question.type === "SINGLE_CHOICE" ? "radio" : "checkbox"}
            name={
              question.type === "SINGLE_CHOICE"
                ? `answer-${question.key}`
                : undefined
            }
            checked={
              question.type === "SINGLE_CHOICE"
                ? answer?.type === "SINGLE_CHOICE" &&
                  answer.optionKey === option.key
                : selected.includes(option.key)
            }
            onChange={(event) =>
              question.type === "SINGLE_CHOICE"
                ? update({ type: "SINGLE_CHOICE", optionKey: option.key })
                : update({
                    type: "MULTIPLE_CHOICE",
                    optionKeys: event.target.checked
                      ? [...selected, option.key]
                      : selected.filter((key) => key !== option.key),
                  })
            }
          />
          <MathText>{option.text}</MathText>
        </label>
      ))}
    </div>
  );
}

function BaseAnswerField({ type, questionKey, options, answer, update }: { type: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "NUMERIC"; questionKey: string; options: Array<{ key: string; text: string }>; answer?: Extract<StudentAnswer, { type: "MULTI_PART" }>["parts"][string]; update: (answer: Extract<StudentAnswer, { type: "MULTI_PART" }>["parts"][string]) => void }) {
  if (type === "NUMERIC") return <NumericField key={questionKey} answer={answer?.type === "NUMERIC" ? answer : undefined} update={update} />;
  const selected = answer?.type === "MULTIPLE_CHOICE" ? answer.optionKeys : [];
  return <div className={styles.options}>{options.map((option) => <label key={option.key}><input type={type === "SINGLE_CHOICE" ? "radio" : "checkbox"} name={type === "SINGLE_CHOICE" ? `answer-${questionKey}` : undefined} checked={type === "SINGLE_CHOICE" ? answer?.type === "SINGLE_CHOICE" && answer.optionKey === option.key : selected.includes(option.key)} onChange={(event) => type === "SINGLE_CHOICE" ? update({ type, optionKey: option.key }) : update({ type, optionKeys: event.target.checked ? [...selected, option.key] : selected.filter((key) => key !== option.key) })} /><MathText>{option.text}</MathText></label>)}</div>;
}

function NumericField({
  answer,
  update,
}: {
  answer?: Extract<StudentAnswer, { type: "NUMERIC" }>;
  update: (answer: Extract<StudentAnswer, { type: "NUMERIC" }>) => void;
}) {
  const [raw, setRaw] = useState(
    answer?.value === null || answer?.value === undefined
      ? ""
      : String(answer.value),
  );

  return (
    <label className={styles.numeric}>
      Ваш ответ
      <input
        inputMode="decimal"
        value={raw}
        onChange={(event) => {
          const next = event.target.value;
          setRaw(next);
          const normalized = next.trim().replace(",", ".");
          if (normalized === "") update({ type: "NUMERIC", value: null });
          else if (
            /^-?(?:\d+\.?\d*|\.\d+)$/.test(normalized) &&
            !normalized.endsWith(".")
          ) {
            const value = Number(normalized);
            if (Number.isFinite(value)) update({ type: "NUMERIC", value });
          }
        }}
        onBlur={() => {
          const normalized = raw.trim().replace(",", ".");
          if (normalized && Number.isFinite(Number(normalized))) {
            const value = Number(normalized);
            setRaw(String(value));
            update({ type: "NUMERIC", value });
          }
        }}
        placeholder="Например, 10 или 10,5"
      />
    </label>
  );
}
