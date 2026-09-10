"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import MathText from "@/components/tests/math-text";
import QuestionImage from "@/components/tests/question-image";
import { QuestionAnswerField, emptyStudentAnswer } from "@/components/student/tests/test-runner";
import { taskCountLabel } from "@/lib/mistakes/labels";
import type { StudentMistakeSession } from "@/lib/mistakes/runtime";
import { answerIsFilled } from "@/lib/tests/grade-student-attempt";
import type { StudentAnswer } from "@/lib/tests/student-test-types";
import { submitMistakeAnswer } from "./actions";
import styles from "./mistakes.module.css";

export default function MistakeRunner({ initial }: { initial: StudentMistakeSession }) {
  const item = initial.mistake!;
  const router = useRouter();
  const [answer, setAnswer] = useState<StudentAnswer>(() => emptyStudentAnswer(item.question.type));
  const [feedback, setFeedback] = useState<"wrong" | "correct" | "error" | null>(null);
  const [pending, start] = useTransition();
  const count = feedback === "correct" ? Math.max(0, initial.activeCount - 1) : initial.activeCount;

  function check() {
    if (!answerIsFilled(answer) || pending || feedback === "correct") return;
    setFeedback(null);
    const requestId = crypto.randomUUID();
    start(async () => {
      const result = await submitMistakeAnswer(item.id, item.activationVersion, answer, requestId);
      if (result.status === "correct") setFeedback("correct");
      else if (result.status === "wrong") setFeedback("wrong");
      else {
        setFeedback("error");
        if (result.status === "stale" || result.status === "not_oldest") router.refresh();
      }
    });
  }

  return <section className={styles.runner}>
    <div className={styles.count}>{taskCountLabel(count)}</div>
    <article className={styles.question}>
      <small>{item.sourceTitle} · {new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(new Date(item.lastFailedAt))}</small>
      <h2><MathText>{item.question.prompt || "Вопрос с изображением"}</MathText></h2>
      {item.question.imageUrl && <QuestionImage src={item.question.imageUrl}/>}
      <fieldset disabled={pending || feedback === "correct"}>
        <QuestionAnswerField question={item.question} answer={answer} update={(next) => { setAnswer(next); if (feedback === "wrong") setFeedback(null); }}/>
      </fieldset>
      {feedback === "wrong" && <p className={styles.wrong} role="status">Неверно. Попробуйте ещё раз.</p>}
      {feedback === "correct" && <p className={styles.correct} role="status">Правильно</p>}
      {feedback === "error" && <p className={styles.wrong} role="alert">Не удалось проверить ответ. Попробуйте ещё раз.</p>}
      {feedback === "correct" ? (count ? <button onClick={() => router.refresh()}>Дальше</button> : <div className={styles.done}><h3>Все ошибки разобраны</h3></div>) : <button onClick={check} disabled={pending || !answerIsFilled(answer)}>{pending ? "Проверяем…" : "Проверить"}</button>}
    </article>
  </section>;
}
