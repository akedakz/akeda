"use client";

import FormulaEditor from "@/components/formula-editor/formula-editor";
import type { FormulaRecallCreateDraft } from "@/lib/formula-recall/types";
import styles from "./formula-recall.module.css";
import batchStyles from "./formula-batch-create.module.css";

type EditableItem = { id: string; value: string };
export type EditableFormulaDraft = {
  id: string;
  canonicalExpression: string;
  conditions: EditableItem[];
  alternatives: EditableItem[];
};

export function createEditableFormulaDraft(id: string, conditionIds: string[]): EditableFormulaDraft {
  return { id, canonicalExpression: "", conditions: conditionIds.map((conditionId) => ({ id: conditionId, value: "" })), alternatives: [] };
}

export function hasMeaningfulFormulaInput(draft: EditableFormulaDraft) {
  return Boolean(draft.canonicalExpression.trim() || draft.conditions.some((item) => item.value.trim()) || draft.alternatives.some((item) => item.value.trim()));
}

export function toFormulaRecallCreateDraft(draft: EditableFormulaDraft): FormulaRecallCreateDraft {
  return {
    canonicalExpression: draft.canonicalExpression,
    conditions: draft.conditions.map((item) => ({ id: item.id, text: item.value })),
    alternatives: draft.alternatives.map((item) => ({ id: item.id, expression: item.value })),
  };
}

export default function FormulaRecallDraftFields({ draft, onChange, pending, formulaNumber, cardLayout = false }: {
  draft: EditableFormulaDraft;
  onChange: (draft: EditableFormulaDraft) => void;
  pending: boolean;
  formulaNumber?: number;
  cardLayout?: boolean;
}) {
  const sectionClass = `${styles.section} ${cardLayout ? batchStyles.cardSection : ""}`.trim();
  const advancedClass = `${styles.advanced} ${cardLayout ? batchStyles.cardAdvanced : ""}`.trim();
  const labelSuffix = formulaNumber ? ` формулы ${formulaNumber}` : "";
  const newId = () => crypto.randomUUID();

  return <>
    <section className={sectionClass}><div className={styles.sectionTitle}><h2>Формула</h2><p>Введите основную запись формулы.</p></div><FormulaEditor value={draft.canonicalExpression} onChange={(canonicalExpression) => onChange({ ...draft, canonicalExpression })} ariaLabel={`Редактор${labelSuffix}`} allowPaste maxExpressionLength={500} disabled={pending}/></section>
    <section className={sectionClass}><div className={styles.sectionTitle}><h2>Условия</h2><p>Разные способы спросить одну и ту же формулу. Рекомендуется 3 разных формулировки.</p></div><div className={styles.conditionList}>{draft.conditions.map((condition, index) => <div className={styles.conditionRow} key={condition.id}><span>{index + 1}.</span><textarea aria-label={`Условие ${index + 1}${labelSuffix}`} value={condition.value} maxLength={500} disabled={pending} onChange={(event) => onChange({ ...draft, conditions: draft.conditions.map((item) => item.id === condition.id ? { ...item, value: event.target.value } : item) })} placeholder="Напишите условие"/><button className={styles.removeButton} type="button" aria-label={`Удалить условие ${index + 1}${labelSuffix}`} disabled={pending || draft.conditions.length === 1} onClick={() => onChange({ ...draft, conditions: draft.conditions.filter((item) => item.id !== condition.id) })}>×</button></div>)}</div><button className={styles.addButton} type="button" disabled={pending || draft.conditions.length >= 30} onClick={() => onChange({ ...draft, conditions: [...draft.conditions, { id: newId(), value: "" }] })}>+ Добавить условие</button></section>
    <details className={advancedClass}><summary>Альтернативные записи</summary><div className={styles.advancedBody}><p>Добавьте другие допустимые обозначения этой же формулы.</p><div className={styles.alternativeList}>{draft.alternatives.map((alternative, index) => <div className={styles.alternativeItem} key={alternative.id}><FormulaEditor value={alternative.value} onChange={(value) => onChange({ ...draft, alternatives: draft.alternatives.map((item) => item.id === alternative.id ? { ...item, value } : item) })} placeholder={`Альтернатива ${index + 1}`} ariaLabel={`Альтернатива ${index + 1}${labelSuffix}`} allowPaste maxExpressionLength={500} disabled={pending}/><button className={styles.removeButton} type="button" aria-label={`Удалить альтернативу ${index + 1}${labelSuffix}`} disabled={pending} onClick={() => onChange({ ...draft, alternatives: draft.alternatives.filter((item) => item.id !== alternative.id) })}>×</button></div>)}</div><button className={styles.addButton} type="button" disabled={pending || draft.alternatives.length >= 20} onClick={() => onChange({ ...draft, alternatives: [...draft.alternatives, { id: newId(), value: "" }] })}>+ Добавить альтернативу</button></div></details>
  </>;
}
