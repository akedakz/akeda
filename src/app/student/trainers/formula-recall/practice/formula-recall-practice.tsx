"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import BackLink from "@/components/back-link";
import FormulaEditor from "@/components/formula-editor/formula-editor";
import MathText from "@/components/tests/math-text";
import type { FormulaRecallStudentSummary, FormulaRecallStudentTask } from "@/lib/formula-recall/runtime-types";
import { acknowledgeFormulaRecallHint, getFormulaRecallTask, submitFormulaRecallAnswer } from "../actions";
import styles from "../formula-recall.module.css";
import runnerStyles from "../../[assignmentId]/runner.module.css";

export default function FormulaRecallPractice({ initialTask, initialSummary, topicId }: { initialTask: FormulaRecallStudentTask | null; initialSummary: FormulaRecallStudentSummary; topicId: string | null }) {
  const [accessDenied, setAccessDenied] = useState(false);
  const [task, setTask] = useState(initialTask);
  const [summary, setSummary] = useState(initialSummary);
  const [answer, setAnswer] = useState("");
  const [message, setMessage] = useState("");
  const [terminal, setTerminal] = useState(initialSummary.assignedCount === 0 ? "empty" : "");
  const [loadingTask, setLoadingTask] = useState(!initialTask && initialSummary.assignedCount > 0);
  const [pending, startTransition] = useTransition();
  const requestStarted = useRef(false);
  const accept = useCallback((result: Awaited<ReturnType<typeof getFormulaRecallTask>>) => { requestStarted.current = false; if (result.status === "student_inactive") { setAccessDenied(true); setLoadingTask(false); setMessage(result.message); return; } if (result.task) { setTask(result.task); setLoadingTask(false); } if (result.summary) setSummary(result.summary); setMessage(result.message); if (result.status === "complete" || result.status === "empty") { setTask(null); setTerminal(result.status); setLoadingTask(false); } else if (!result.task && !result.ok) setLoadingTask(false); }, []);
  const requestTask = useCallback(async (advance = false) => { try { accept(await getFormulaRecallTask(topicId, advance)); } catch { requestStarted.current = false; setLoadingTask(false); setMessage("Не удалось загрузить задание. Проверьте соединение."); } }, [accept, topicId]);
  useEffect(() => { if (accessDenied || task || terminal || !loadingTask || requestStarted.current) return; requestStarted.current = true; startTransition(() => requestTask()); }, [accessDenied, task, terminal, loadingTask, requestTask]);
  const check = () => task && startTransition(async () => accept(await submitFormulaRecallAnswer(task.id, answer)));
  const remembered = () => task && startTransition(async () => { const result = await acknowledgeFormulaRecallHint(task.id); setAnswer(""); accept(result); });
  const next = () => { if (pending || requestStarted.current) return; requestStarted.current = true; setAnswer(""); setMessage(""); setTask(null); setLoadingTask(true); startTransition(() => requestTask(true)); };
  const retryLoad = () => { if (pending) return; setMessage(""); setLoadingTask(true); };
  const revealed = task?.state === "REVEALED";
  const correct = task?.state === "CORRECT_CLEAN" || task?.state === "CORRECT_HINTED";
  return <main className={`${runnerStyles.runner} ${styles.practice}`}><header><BackLink href="/student/trainers/formula-recall">К Formula Recall</BackLink><div><h1>{task?.topicTitle ?? "Formula Recall"}</h1><strong>{summary.progressPercent}%</strong></div><div className={runnerStyles.overall}><i style={{ width: `${summary.progressPercent}%` }}/></div><small>{summary.masteryPoints} из {summary.possiblePoints}</small></header>
    {accessDenied ? <section className={`${runnerStyles.task} ${styles.taskCard}`}><p role="alert">{message}</p><Link href="/student/trainers">К тренажёрам</Link></section> : terminal ? <section className={`${runnerStyles.completion} ${styles.completion}`}><strong>{summary.progressPercent}%</strong><h1>{terminal === "empty" ? "Формулы пока не назначены" : "Все формулы освоены"}</h1><p>{terminal === "empty" ? "Вернитесь позже, когда преподаватель назначит формулы." : "Отличная работа. Новая тренировка появится после назначения новых формул."}</p><Link href="/student/trainers/formula-recall">К обзору</Link></section> : loadingTask ? <FormulaRecallTaskLoading/> : task ? <section className={`${runnerStyles.task} ${styles.taskCard}`}><div className={styles.conditionArea}><h1>{task.condition}</h1></div>{revealed ? <div className={styles.reveal}><strong>Неправильно</strong><p>Правильная формула:</p><MathText>{`$$${task.canonicalExpression ?? ""}$$`}</MathText><button disabled={pending} onClick={remembered}>Запомнил</button></div> : correct ? <div className={styles.correct}><strong>Правильно</strong>{task.state === "CORRECT_HINTED" && <p>Эта формула встретится ещё раз.</p>}<button disabled={pending} onClick={next}>Дальше</button></div> : <><FormulaEditor className={styles.practiceEditor} value={answer} onChange={(value) => { setAnswer(value); setMessage(""); }} allowPaste={false} maxExpressionLength={250}/><button className={styles.check} disabled={pending || !answer.trim()} onClick={check}>{pending ? "Проверяем…" : "Проверить"}</button>{message && <p className={styles.runtimeError} role="status">{message}</p>}</>}</section> : <section className={`${runnerStyles.task} ${styles.taskCard} ${styles.loadError}`}><p role="alert">{message || "Не удалось загрузить задание."}</p><button type="button" onClick={retryLoad}>Повторить</button></section>}
  </main>;
}

function FormulaRecallTaskLoading() {
  return <section className={`${runnerStyles.task} ${styles.taskCard} ${styles.loadingCard}`} role="status" aria-live="polite" aria-label="Загружаем задание"><span aria-hidden="true"/><small>Загружаем задание</small></section>;
}
