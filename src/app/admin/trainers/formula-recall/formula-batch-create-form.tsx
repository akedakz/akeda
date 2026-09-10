"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { validateFormulaRecallDraft } from "@/lib/formula-recall/draft-validation";
import type { FormulaRecallCreateDraft, FormulaRecallTopic } from "@/lib/formula-recall/types";
import { saveFormulaRecallFormulasBatch } from "./actions";
import FormulaRecallDraftFields, { createEditableFormulaDraft, hasMeaningfulFormulaInput, toFormulaRecallCreateDraft, type EditableFormulaDraft } from "./formula-draft-fields";
import styles from "./formula-recall.module.css";
import batchStyles from "./formula-batch-create.module.css";

type RequestAttempt = { requestId: string; payload: string };

export default function FormulaRecallBatchCreateForm({ topics, initialDraftId, initialConditionIds }: { topics: FormulaRecallTopic[]; initialDraftId: string; initialConditionIds: string[] }) {
  const router = useRouter();
  const [topicId, setTopicId] = useState(topics[0]?.id ?? "");
  const [drafts, setDrafts] = useState<EditableFormulaDraft[]>(() => [createEditableFormulaDraft(initialDraftId, initialConditionIds)]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const submitGuard = useRef(false);
  const requestAttempt = useRef<RequestAttempt | null>(null);

  const focusCard = (draftId: string) => requestAnimationFrame(() => {
    document.getElementById(`formula-draft-${draftId}`)?.focus({ preventScroll: true });
    document.getElementById(`formula-draft-${draftId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  const updateDraft = (next: EditableFormulaDraft) => {
    setDrafts((items) => items.map((item) => item.id === next.id ? next : item));
    setErrors((current) => { const copy = { ...current }; delete copy[next.id]; return copy; });
  };
  const addDraft = () => {
    const id = crypto.randomUUID();
    setDrafts((items) => [...items, createEditableFormulaDraft(id, [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()])]);
    focusCard(id);
  };
  const removeDraft = (draftId: string) => {
    if (drafts.length === 1) return;
    setDrafts((items) => items.filter((item) => item.id !== draftId));
    setErrors((current) => { const copy = { ...current }; delete copy[draftId]; return copy; });
  };

  const save = () => {
    if (submitGuard.current) return;
    submitGuard.current = true;
    setMessage("");
    setErrors({});
    if (!topicId) {
      setMessage("Выберите тему.");
      submitGuard.current = false;
      return;
    }

    const candidates = drafts.flatMap((draft, draftIndex) => hasMeaningfulFormulaInput(draft) ? [{ draft, draftIndex }] : []);
    if (!candidates.length) {
      const first = drafts[0];
      setErrors({ [first.id]: "Введите формулу." });
      focusCard(first.id);
      submitGuard.current = false;
      return;
    }
    const formulas: FormulaRecallCreateDraft[] = [];
    for (const candidate of candidates) {
      const values = toFormulaRecallCreateDraft(candidate.draft);
      const validation = validateFormulaRecallDraft({ formulaId: null, topicId, expectedRevision: null, ...values });
      if (!validation.ok) {
        setErrors({ [candidate.draft.id]: validation.message });
        focusCard(candidate.draft.id);
        submitGuard.current = false;
        return;
      }
      formulas.push({ canonicalExpression: validation.draft.canonicalExpression, conditions: validation.draft.conditions, alternatives: validation.draft.alternatives });
    }

    const payload = JSON.stringify({ topicId, formulas });
    if (!requestAttempt.current || requestAttempt.current.payload !== payload) requestAttempt.current = { requestId: crypto.randomUUID(), payload };
    const requestId = requestAttempt.current.requestId;
    start(async () => {
      try {
        const result = await saveFormulaRecallFormulasBatch({ requestId, topicId, formulas });
        if (result.ok) { router.push("/admin/trainers/formula-recall"); return; }
        if (result.code === "request_conflict") requestAttempt.current = null;
        if (typeof result.formulaIndex === "number") {
          const invalid = candidates[result.formulaIndex];
          if (invalid) {
            setMessage(`Формула ${invalid.draftIndex + 1}: ${result.message}`);
            setErrors({ [invalid.draft.id]: result.message });
            focusCard(invalid.draft.id);
          } else setMessage(result.message);
        } else {
          setMessage(result.message);
        }
      } catch {
        setMessage("Не удалось получить ответ сервера. Повторите сохранение — тот же запрос не создаст дубликаты.");
      } finally {
        submitGuard.current = false;
      }
    });
  };

  const realDraftCount = drafts.filter(hasMeaningfulFormulaInput).length;
  const saveLabel = realDraftCount <= 1 ? "Сохранить" : `Сохранить ${realDraftCount} ${formulaWord(realDraftCount)}`;
  return <form className={styles.editorForm} onSubmit={(event) => { event.preventDefault(); save(); }}>
    <section className={styles.section}><div className={styles.sectionTitle}><h2>Тема</h2><p>Выбранная тема применяется ко всем формулам в этом наборе.</p></div><label className={styles.selectLabel}>Выберите тему<select value={topicId} onChange={(event) => setTopicId(event.target.value)} disabled={pending}>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label></section>
    <div className={batchStyles.draftList}>{drafts.map((draft, index) => <article className={batchStyles.draftCard} id={`formula-draft-${draft.id}`} key={draft.id} tabIndex={-1} data-invalid={Boolean(errors[draft.id]) || undefined}><header className={batchStyles.draftHeader}><h2>Формула {index + 1}</h2>{drafts.length > 1 && <button className={styles.dangerButton} type="button" disabled={pending} onClick={() => removeDraft(draft.id)}>Удалить формулу</button>}</header><FormulaRecallDraftFields draft={draft} onChange={updateDraft} pending={pending} formulaNumber={index + 1} cardLayout/>{errors[draft.id] && <p className={batchStyles.cardError} role="alert">{errors[draft.id]}</p>}</article>)}</div>
    <button className={batchStyles.addFormula} type="button" disabled={pending || drafts.length >= 50} onClick={addDraft}>+ Добавить ещё формулу</button>
    <p className={batchStyles.batchHint}>До 50 формул за одно сохранение. Полностью пустые дополнительные карточки будут пропущены.</p>
    {message && <p className={styles.editorMessage} role="status">{message}</p>}
    <div className={styles.editorActions}><Link className={styles.secondaryButton} href="/admin/trainers/formula-recall">Отмена</Link><button className={styles.primaryButton} disabled={pending || !topicId}>{pending ? "Сохраняем..." : saveLabel}</button></div>
  </form>;
}

function formulaWord(count: number) {
  const mod100 = count % 100; const mod10 = count % 10;
  return mod100 >= 11 && mod100 <= 14 ? "формул" : mod10 >= 2 && mod10 <= 4 ? "формулы" : "формул";
}
