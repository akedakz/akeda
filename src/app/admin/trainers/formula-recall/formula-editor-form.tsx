"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { FormulaRecallDraft, FormulaRecallFormula, FormulaRecallTopic } from "@/lib/formula-recall/types";
import { saveFormulaRecallFormula } from "./actions";
import FormulaRecallDraftFields, { type EditableFormulaDraft, toFormulaRecallCreateDraft } from "./formula-draft-fields";
import styles from "./formula-recall.module.css";

export default function FormulaRecallEditorForm({ topics, formula, initialConditionIds }: { topics: FormulaRecallTopic[]; formula?: FormulaRecallFormula; initialConditionIds?: string[] }) {
  const router = useRouter();
  const [topicId, setTopicId] = useState(formula?.topicId ?? topics[0]?.id ?? "");
  const [draft, setDraft] = useState<EditableFormulaDraft>({ id: formula?.id ?? "single", canonicalExpression: formula?.canonicalExpression ?? "", conditions: formula ? formula.conditions.map((item) => ({ id: item.id, value: item.text })) : (initialConditionIds ?? []).map((id) => ({ id, value: "" })), alternatives: formula?.alternatives.map((item) => ({ id: item.id, value: item.expression })) ?? [] });
  const [message, setMessage] = useState(""); const [pending, start] = useTransition();

  const save = () => start(async () => {
    const values = toFormulaRecallCreateDraft(draft);
    const savedDraft: FormulaRecallDraft = {
      formulaId: formula?.id ?? null, topicId, canonicalExpression: values.canonicalExpression, expectedRevision: formula?.contentRevision ?? null,
      conditions: values.conditions, alternatives: values.alternatives,
    };
    const result = await saveFormulaRecallFormula(savedDraft); setMessage(result.message);
    if (result.ok) router.push("/admin/trainers/formula-recall");
  });
  const validConditions = draft.conditions.some((item) => item.value.trim());

  return <form className={styles.editorForm} onSubmit={(event) => { event.preventDefault(); save(); }}>
    <section className={styles.section}><div className={styles.sectionTitle}><h2>Тема</h2></div><label className={styles.selectLabel}>Выберите тему<select value={topicId} onChange={(event) => setTopicId(event.target.value)} disabled={pending}>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label></section>
    <FormulaRecallDraftFields draft={draft} onChange={setDraft} pending={pending}/>
    {message && <p className={styles.editorMessage} role="status">{message}</p>}
    <div className={styles.editorActions}><Link className={styles.secondaryButton} href="/admin/trainers/formula-recall">Отмена</Link><button className={styles.primaryButton} disabled={pending || !topicId || !draft.canonicalExpression.trim() || !validConditions}>{pending ? "Сохраняем…" : "Сохранить"}</button></div>
  </form>;
}
