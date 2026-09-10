"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import BackLink from "@/components/back-link";
import MathText from "@/components/tests/math-text";
import type { NormalTaskBundle, RunnerTaskPacket } from "@/lib/trainers/quick-problem-runner-server";
import { recordQuickProblemAnswer, refillHintTasks, refillNormalTasks } from "./actions";
import styles from "./runner.module.css";

type Session = { snapshot: { assignmentId: string; trainerTitle: string; skillsCount: number; creditedTotal: number; creditedBySkill: Record<string, number>; progressPercent: number; storageScope: string }; bundles: NormalTaskBundle[] };
type Feedback = { tone: "correct" | "wrong" | "skill"; text: string } | null;
type SkillComplete = { skillKey: string; skillName: string; confirmed: boolean } | null;
type PendingAnswer = { assignmentId: string; taskId: string; submittedAnswer: number; contentRevision: number };
const pendingPrefix = "nsp:quick-problems:pending:v1:";
const pendingLimit = 50;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function pendingKey(scope: string) { return `${pendingPrefix}${scope}`; }
function readPending(scope: string): PendingAnswer[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(pendingKey(scope)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PendingAnswer => typeof item === "object" && item !== null && uuid.test(String((item as PendingAnswer).assignmentId)) && uuid.test(String((item as PendingAnswer).taskId)) && Number.isSafeInteger((item as PendingAnswer).submittedAnswer) && Math.abs((item as PendingAnswer).submittedAnswer) <= 1_000_000_000 && Number.isInteger((item as PendingAnswer).contentRevision) && (item as PendingAnswer).contentRevision > 0).slice(-pendingLimit);
  } catch { return []; }
}
function writePending(scope: string, records: PendingAnswer[]) { try { const limited = records.slice(-pendingLimit); if (limited.length) localStorage.setItem(pendingKey(scope), JSON.stringify(limited)); else localStorage.removeItem(pendingKey(scope)); } catch { /* storage can be unavailable */ } }
function persistPending(scope: string, record: PendingAnswer) { const records = readPending(scope).filter((item) => item.taskId !== record.taskId); writePending(scope, [...records, record]); }
function removePending(scope: string, taskId: string) { writePending(scope, readPending(scope).filter((item) => item.taskId !== taskId)); }
function authoritative(response: Awaited<ReturnType<typeof recordQuickProblemAnswer>>) { return response.ok || response.status !== "server_error"; }

async function commitment(salt: string, answer: number) {
  // Preview/local consistency only. Student feedback waits for server confirmation.
  const data = new TextEncoder().encode(`${salt}:${answer}`); const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default function QuickProblemsRunner({ initial, previewMode = false }: { initial: Session; previewMode?: boolean }) {
  const router = useRouter(); const assignmentId = initial.snapshot.assignmentId; const first = initial.bundles[0];
  const [current, setCurrent] = useState<RunnerTaskPacket>(first.task);
  const [answer, setAnswer] = useState(""); const [validation, setValidation] = useState(""); const [feedback, setFeedback] = useState<Feedback>(null); const [skillComplete, setSkillComplete] = useState<SkillComplete>(null); const [progress, setProgress] = useState(initial.snapshot.progressPercent); const [completed, setCompleted] = useState(false); const [connection, setConnection] = useState(""); const [recovering, setRecovering] = useState(!previewMode); const [continuing, setContinuing] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const accessDeniedRef = useRef(false);

  const input = useRef<HTMLInputElement>(null); const submitting = useRef(false); const continuingRef = useRef(false); const refillingNormal = useRef(false); const completedSkills = useRef(new Set<string>()); const skillCredits = useRef(new Map(Object.entries(initial.snapshot.creditedBySkill))); const normalQueue = useRef(initial.bundles.slice(1)); const hintQueue = useRef(first.retries); const currentTask = useRef(current); const replayStarted = useRef(false); const transitionTimer = useRef<number | null>(null);
  const denyAccess = () => {
    accessDeniedRef.current = true; setAccessDenied(true); setFeedback(null); setSkillComplete(null);
    if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
    writePending(initial.snapshot.storageScope, readPending(initial.snapshot.storageScope).filter((record) => record.assignmentId !== assignmentId));
  };

  useEffect(() => { currentTask.current = current; input.current?.focus(); submitting.current = false; }, [current]);
  useEffect(() => () => { if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current); }, []);

  const refillNormal = async (replace = false) => {
    if (accessDeniedRef.current || (refillingNormal.current && !replace) || completed) return; refillingNormal.current = true;
    const result = await refillNormalTasks(assignmentId); refillingNormal.current = false;
    if (accessDeniedRef.current) return;
    if (!result.ok && result.status === "student_inactive") { denyAccess(); return; }
    if (!result.ok) { if (result.status === "assignment_not_found") router.replace("/student/trainers/quick-problems?unavailable=1"); else setConnection("Не удалось пополнить очередь. Проверьте соединение."); return; }
    setConnection("");
    const bundles = result.data.bundles.filter((bundle) => !completedSkills.current.has(bundle.task.skillKey));
    for (const [skillKey, credited] of Object.entries(result.data.snapshot.creditedBySkill)) skillCredits.current.set(skillKey, credited);
    if (replace) {
      const [next, ...rest] = bundles;
      if (!next) { void refillNormal(true); return; }
      setCurrent(next.task); hintQueue.current = next.retries; normalQueue.current = rest; setProgress(result.data.snapshot.progressPercent);
    }
    else normalQueue.current.push(...bundles);
  };

  const nextNormal = () => {
    if (accessDeniedRef.current) return;
    const next = normalQueue.current.shift();
    if (next) { setCurrent(next.task); hintQueue.current = next.retries; if (!previewMode && normalQueue.current.length <= 2) void refillNormal(); }
    else if (!previewMode) { setConnection("Готовим следующие задачи…"); void refillNormal(true); }
  };
  const nextHint = () => { if (accessDeniedRef.current) return; const next = hintQueue.current.shift(); if (next) setCurrent(next); else setConnection("Готовим новую попытку…"); };

  const continueAfterSkill = async () => {
    if (accessDeniedRef.current || !skillComplete?.confirmed || continuingRef.current) return;
    continuingRef.current = true; setContinuing(true);
    normalQueue.current = normalQueue.current.filter((bundle) => bundle.task.skillKey !== skillComplete.skillKey);
    const next = normalQueue.current.shift();
    setFeedback(null); setSkillComplete(null); setConnection("");
    if (next) {
      setCurrent(next.task); hintQueue.current = next.retries;
      if (!previewMode && normalQueue.current.length <= 2) void refillNormal();
    } else if (previewMode) {
      setCompleted(true);
    } else {
      setConnection("Готовим следующую задачу…");
      await refillNormal(true);
    }
    continuingRef.current = false; setContinuing(false);
  };

  const handleServer = async (task: RunnerTaskPacket, localCorrect: boolean, predictedSkillCompletion: boolean, response: Awaited<ReturnType<typeof recordQuickProblemAnswer>>) => {
    if (accessDeniedRef.current) return;
    if (!response.ok && response.status === "student_inactive") { denyAccess(); return; }
    const clearOptimisticCompletion = () => { setSkillComplete(null); setFeedback(null); };
    if (!response.ok) { submitting.current = false; clearOptimisticCompletion(); input.current?.focus(); setConnection("Связь с сервером прервалась. Повторите действие после восстановления соединения."); return; }
    const result = response.result;
    if (["stale_trainer", "stale_skills"].includes(result.status)) { clearOptimisticCompletion(); setConnection("Тренажёр был обновлён. Продолжаем с новой версией."); await refillNormal(true); return; }
    if (["assignment_not_found", "trainer_deleted"].includes(result.status)) { router.replace("/student/trainers/quick-problems?unavailable=1"); return; }
    if (result.status === "already_consumed") { clearOptimisticCompletion(); await refillNormal(true); return; }
    if (result.status !== "recorded" || result.correct !== localCorrect) { clearOptimisticCompletion(); setConnection("Состояние обновилось. Восстанавливаем актуальную очередь…"); await refillNormal(true); return; }
    setConnection(""); if (typeof result.progress_percent === "number") setProgress((value) => Math.max(value, result.progress_percent!));
    if (typeof result.credited_correct === "number") skillCredits.current.set(task.skillKey, result.credited_correct);
    if (result.trainer_completed) { setCompleted(true); return; }
    if (result.skill_completed && task.mode === "NORMAL") {
      if (transitionTimer.current !== null) { window.clearTimeout(transitionTimer.current); transitionTimer.current = null; }
      completedSkills.current.add(task.skillKey);
      normalQueue.current = normalQueue.current.filter((bundle) => bundle.task.skillKey !== task.skillKey);
      submitting.current = false;
      setFeedback({ tone: "skill", text: `${task.skillName} освоен ✓` });
      setSkillComplete({ skillKey: task.skillKey, skillName: task.skillName, confirmed: true });
      return;
    }
    if (predictedSkillCompletion) { clearOptimisticCompletion(); await refillNormal(true); return; }
    setAnswer("");
    if (localCorrect) {
      setFeedback({ tone: "correct", text: "Верно" });
      transitionTimer.current = window.setTimeout(() => { setFeedback(null); nextNormal(); }, 350);
    } else {
      setFeedback({ tone: "wrong", text: "Попробуй ещё раз" });
      transitionTimer.current = window.setTimeout(() => { setFeedback(null); nextHint(); }, 260);
    }
    if (!localCorrect) {
      const retry = await refillHintTasks(assignmentId, task.id);
      if (!retry.ok && retry.status === "student_inactive") { denyAccess(); return; }
      if (accessDeniedRef.current) return;
      if (retry.ok && currentTask.current.mode === "HINT" && currentTask.current.skillKey === task.skillKey) { if (!hintQueue.current.length) { const [next, ...rest] = retry.tasks; hintQueue.current = rest; if (next) { setCurrent(next); setConnection(""); } } else hintQueue.current.push(...retry.tasks); }
    }
  };

  useEffect(() => {
    if (replayStarted.current) return; replayStarted.current = true;
    if (previewMode) return;
    void (async () => {
      const stored = readPending(initial.snapshot.storageScope); writePending(initial.snapshot.storageScope, stored);
      const records = stored.filter((record) => record.assignmentId === assignmentId);
      let reconciled = false;
      for (const record of records) {
        let response: Awaited<ReturnType<typeof recordQuickProblemAnswer>> | null = null;
        try { response = await recordQuickProblemAnswer(record.assignmentId, record.taskId, record.submittedAnswer); } catch { response = null; }
        if (response && !response.ok && response.status === "student_inactive") { denyAccess(); setRecovering(false); return; }
        if (response && authoritative(response)) { removePending(initial.snapshot.storageScope, record.taskId); reconciled = true; }
        else { setConnection("Не удалось восстановить несинхронизированный ответ. Проверьте соединение."); break; }
      }
      if (reconciled) await refillNormal(true);
      setRecovering(false);
    })();
  // Session identity is immutable for the lifetime of this runner.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewMode]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (accessDeniedRef.current) return; if (skillComplete) { if (skillComplete.confirmed) void continueAfterSkill(); return; } if (submitting.current || completed || recovering) return;
    const normalized = answer.trim(); if (!/^[+-]?\d+$/.test(normalized)) { setValidation("Введите целое число"); return; }
    const numeric = Number(normalized); if (!Number.isSafeInteger(numeric) || Math.abs(numeric) > 1_000_000_000) { setValidation("Введите целое число"); return; }
    submitting.current = true; setValidation(""); const task = current; const pending = { assignmentId, taskId: task.id, submittedAnswer: numeric, contentRevision: task.contentRevision }; const localCorrect = await commitment(task.answerSalt, numeric) === task.answerCommitment;
    const creditedBefore = skillCredits.current.get(task.skillKey) ?? 0;
    const potentialSkillCompletion = localCorrect && task.mode === "NORMAL" && creditedBefore === 4;
    if (previewMode) {
      setAnswer(""); submitting.current = false;
      if (localCorrect) {
        if (task.mode === "NORMAL") { skillCredits.current.set(task.skillKey, Math.min(5, creditedBefore + 1)); setProgress((value) => Math.min(100, value + 100 / (initial.snapshot.skillsCount * 5))); }
        if (potentialSkillCompletion) { completedSkills.current.add(task.skillKey); setFeedback({ tone: "skill", text: `${task.skillName} освоен ✓` }); setSkillComplete({ skillKey: task.skillKey, skillName: task.skillName, confirmed: true }); }
        else { setFeedback({ tone: "correct", text: "Верно" }); transitionTimer.current = window.setTimeout(() => { setFeedback(null); nextNormal(); }, 350); }
      } else { setFeedback({ tone: "wrong", text: "Попробуй ещё раз" }); window.setTimeout(() => { setFeedback(null); nextHint(); }, 260); }
      return;
    }
    persistPending(initial.snapshot.storageScope, pending);
    void (async () => {
      let response: Awaited<ReturnType<typeof recordQuickProblemAnswer>> | null = null;
      for (let attempt = 0; attempt < 2 && !response?.ok && (!response || response.status !== "student_inactive") && !accessDeniedRef.current; attempt += 1) { try { response = await recordQuickProblemAnswer(assignmentId, task.id, numeric); } catch { response = null; } }
      if (!response) { submitting.current = false; setFeedback(null); input.current?.focus(); setConnection("Не удалось синхронизировать прогресс. Проверьте соединение."); return; }
      if (authoritative(response)) removePending(initial.snapshot.storageScope, task.id);
      await handleServer(task, localCorrect, potentialSkillCompletion, response);
    })().catch(() => { submitting.current = false; setFeedback(null); input.current?.focus(); setConnection("Не удалось синхронизировать прогресс. Проверьте соединение."); });

  };

  const backHref = previewMode ? "/admin/trainers/quick-problems" : "/student/trainers/quick-problems";
  if (accessDenied) return <main className={styles.runner}><BackLink href={backHref}>Quick Problems</BackLink><p role="alert">{"Доступ к тренажёрам приостановлен."}</p></main>;
  if (completed) return <main className={styles.completion}><div className={styles.completionMark}>✓</div><h1>{initial.snapshot.trainerTitle}</h1><strong>100%</strong><h2>Тренажёр завершён</h2><p>Все формулы освоены.</p><Link href={backHref}>Вернуться к Quick Problems</Link></main>;
  return <main className={styles.runner}><header><BackLink href={backHref}>Quick Problems</BackLink><div><h1>{initial.snapshot.trainerTitle}</h1><strong>{Math.round(progress)}%</strong></div><div className={styles.overall}><i style={{ width: `${Math.min(100, progress)}%` }}/></div></header><section className={`${styles.task} ${feedback ? styles[feedback.tone] : ""}`} aria-live="polite">{current.mode === "HINT" && <div className={styles.hint}><span>Попробуй ещё раз</span><MathText>{`$$${current.formulaLatex}$$`}</MathText></div>}<p className={styles.prompt}>{current.prompt}</p><form onSubmit={submit}><div className={styles.answer}><input ref={input} type="text" inputMode="numeric" autoComplete="off" value={answer} disabled={recovering} onChange={(event) => { setAnswer(event.target.value); setValidation(""); }} aria-label={`Ответ в ${current.answerUnit}`} aria-describedby={validation ? "integer-validation" : undefined}/><span>{current.answerUnit}</span></div>{validation && <small id="integer-validation" className={styles.validation}>{validation}</small>}<button type="submit" disabled={recovering}>{recovering ? "Синхронизация…" : "Проверить"}</button></form>{feedback && <div className={styles.feedback}><div><span>{feedback.text}</span>{skillComplete && <form onSubmit={(event) => { event.preventDefault(); void continueAfterSkill(); }}><button type="submit" disabled={!skillComplete.confirmed || continuing}>{continuing ? "Загрузка…" : skillComplete.confirmed ? "Продолжить" : "Подтверждаем…"}</button></form>}</div></div>}</section>{connection && <p className={styles.connection} role="status">{connection}</p>}<p className={styles.keyboard}>Enter — {skillComplete ? skillComplete.confirmed ? "продолжить" : "ожидаем подтверждение" : "проверить ответ"}</p></main>;
}
