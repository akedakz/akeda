"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import BackLink from "@/components/back-link";
import MathText from "@/components/tests/math-text";
import type { TheoryRunnerSession } from "@/lib/trainers/theory-runtime";
import { recordTheoryAnswer } from "./actions";
import styles from "./theory-runner.module.css";

type SafeQuestion = TheoryRunnerSession["task"];
type Feedback = { selected: number; correct: boolean; correctOption: number; explanation: string; mastery: number; completed: boolean; nextQuestion: SafeQuestion | null };

export default function TheoryRunner({ initial }: { initial: TheoryRunnerSession }) {
  const router = useRouter();
  const questionRef = useRef<HTMLElement>(null);
  const [session, setSession] = useState(initial);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => { router.prefetch("/student/trainers/theory"); }, [router]);

  const answer = (selectedOption: number) => {
    if (accessDenied || feedback || pending || selected !== null) return;
    setSelected(selectedOption);
    setMessage("");
    startTransition(async () => {
      const response = await recordTheoryAnswer(session.assignmentId, session.task.id, selectedOption);
      if (!response.ok && response.status === "student_inactive") { setAccessDenied(true); setSelected(null); setMessage(response.message); return; }
      if (!response.ok) { setSelected(null); setMessage("Не удалось проверить ответ. Попробуйте ещё раз."); return; }
      const result = response.result;
      const nextQuestion = result.next_question ? { id: result.next_question.id, questionKey: result.next_question.question_key, text: result.next_question.text, options: result.next_question.options, mastery: result.next_question.mastery } : null;
      if (result.status === "stale") {
        if (nextQuestion) {
          setSession((current) => ({ ...current, task: nextQuestion, earned: result.earned ?? current.earned, required: result.required ?? current.required, progressPercent: result.progress_percent ?? current.progressPercent }));
          setSelected(null);
          setMessage("Вопрос обновился — показываем актуальную версию.");
        } else router.replace("/student/trainers/theory");
        return;
      }
      if (result.status !== "recorded" || result.correct_option === undefined) { setSelected(null); setMessage("Ответ уже обработан или назначение недоступно."); return; }
      setSession((current) => ({ ...current, earned: result.earned ?? current.earned, required: result.required ?? current.required, progressPercent: result.progress_percent ?? current.progressPercent }));
      setFeedback({ selected: selectedOption, correct: Boolean(result.correct), correctOption: result.correct_option, explanation: result.explanation ?? "", mastery: result.question_count ?? session.task.mastery, completed: Boolean(result.trainer_completed), nextQuestion });
    });
  };

  const next = () => {
    if (!feedback) return;
    if (feedback.completed) { router.replace("/student/trainers/theory"); return; }
    if (!feedback.nextQuestion) { setMessage("Следующий вопрос недоступен. Обновите страницу."); return; }
    setSession((current) => ({ ...current, task: feedback.nextQuestion as SafeQuestion }));
    setFeedback(null); setSelected(null); setMessage("");
    requestAnimationFrame(() => questionRef.current?.focus({ preventScroll: true }));
  };

  return <main className={styles.runner}>
    <BackLink href="/student/trainers/theory">Theory</BackLink>
    <header><div><h1>{session.title}</h1><strong>{session.progressPercent}%</strong></div><i><b style={{ width: `${session.progressPercent}%` }}/></i></header>
    <section className={styles.question} ref={questionRef} tabIndex={-1}>
      <div className={styles.mastery}>Вопрос: <strong>{feedback?.mastery ?? session.task.mastery}/3{(feedback?.mastery ?? session.task.mastery) === 3 ? " ✓" : ""}</strong></div>
      <MathText className={styles.prompt}>{session.task.text}</MathText>
      <div className={styles.options}>{session.task.options.map((option, index) => {
        const tone = feedback ? index === feedback.correctOption ? styles.correct : index === feedback.selected ? styles.wrong : "" : selected === index ? styles.selected : "";
        return <button className={tone} type="button" disabled={accessDenied || pending || selected !== null || Boolean(feedback)} onClick={() => answer(index)} key={index} aria-pressed={selected === index}><b>{String.fromCharCode(65 + index)}</b><MathText>{option}</MathText></button>;
      })}</div>
      {feedback && <div className={feedback.correct ? styles.goodFeedback : styles.badFeedback}>
        <div className={styles.feedbackContent}><strong>{feedback.correct ? "Верно" : "Неверно"}</strong>{!feedback.correct && feedback.explanation && <MathText className={styles.explanation}>{feedback.explanation}</MathText>}</div>
        <div className={styles.feedbackActions}><button onClick={next}>{feedback.completed ? "К тренажёрам" : "Дальше"}</button></div>
      </div>}
      {message && <p className={styles.message} role="status">{message}</p>}
    </section>
  </main>;
}
