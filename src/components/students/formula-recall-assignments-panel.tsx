"use client";
import { useState } from "react";
import { assignFormulaRecallFormulas, unassignFormulaRecallFormulas } from "@/app/admin/students/[id]/formula-recall-actions";
import MathText from "@/components/tests/math-text";
import type { FormulaRecallAssignmentTopic, FormulaRecallStudentSummary } from "@/lib/formula-recall/runtime-types";
import { AssignmentModal, ManagementModal, SelectAll, TrainerSection, useManagementMutation } from "./trainer-management-ui";
import styles from "./trainer-management.module.css";
export default function FormulaRecallAssignmentsPanel({ studentId, topics, summary, loadError }: { studentId: string; topics: FormulaRecallAssignmentTopic[]; summary: FormulaRecallStudentSummary; loadError?: string }) {
  const [assign, setAssign] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const mutation = useManagementMutation();
  const ids = topics.flatMap((topic) => topic.formulas.flatMap((formula) => formula.assignmentId ? [formula.assignmentId] : []));
  const effective = selected.filter((id) => ids.includes(id));
  return <>
    <TrainerSection title="Formula Recall" icon="ƒ" count={summary.assignedCount + " формул назначено"} onAssign={() => setAssign(true)}>
      {loadError ? <p className={styles.error}>{loadError}</p> : !ids.length ? <p className={styles.empty}>Нет назначенных формул</p> : <>
        <div className={styles.toolbar}><SelectAll ids={ids} selected={effective} onChange={setSelected} disabled={mutation.pending}/>{effective.length > 0 && <><span>Выбрано: {effective.length}</span><button className={styles.secondary} disabled={mutation.pending || effective.length > 500} onClick={() => { mutation.clear(); setConfirm(true); }}>Отменить выбранные</button></>}</div>
        {effective.length > 500 && <p className={styles.error}>За один раз можно отменить до 500 назначений.</p>}
        {topics.map((topic) => { const assigned = topic.formulas.filter((formula) => formula.assignmentId); return assigned.length ? <section className={styles.group} key={topic.id}><h3>{topic.title}</h3>{assigned.map((formula) => <label className={styles.choice} key={formula.assignmentId}>
          <input type="checkbox" aria-label={"Выбрать формулу " + formula.expression} disabled={mutation.pending} checked={effective.includes(formula.assignmentId!)} onChange={() => setSelected((current) => current.includes(formula.assignmentId!) ? current.filter((id) => id !== formula.assignmentId) : [...current, formula.assignmentId!])}/>
          <span className={styles.choiceCopy}><span className={styles.formula}><MathText>{"$" + formula.expression + "$"}</MathText></span><small>{formula.cleanRecallCount}/3</small></span>
        </label>)}</section> : null; })}
      </>}
    </TrainerSection>
    {mutation.notice && <p role="status" className={styles.notice}>{mutation.notice}</p>}
    {mutation.error && !confirm && <p role="alert" className={styles.error}>{mutation.error}</p>}
    {assign && <AssignmentModal title="Назначить Formula Recall" close={() => setAssign(false)} action={(values) => assignFormulaRecallFormulas(studentId, values)} groups={topics.map((topic) => ({ id: topic.id, title: topic.title, items: topic.formulas.map((formula) => ({ id: formula.formulaId, content: <span className={styles.formula}><MathText>{"$" + formula.expression + "$"}</MathText></span>, disabledLabel: formula.assignmentId ? "Уже назначена" : undefined })) }))}/>}
    {confirm && <ManagementModal title={"Отменить назначение " + effective.length + " формул?"} pending={mutation.pending} close={() => setConfirm(false)} footer={<><button className={styles.secondary} disabled={mutation.pending} onClick={() => setConfirm(false)}>Отмена</button><button className={styles.primary} disabled={mutation.pending || !effective.length} onClick={() => mutation.run(() => unassignFormulaRecallFormulas(studentId, effective), () => { setConfirm(false); setSelected([]); })}>{mutation.pending ? "Отменяем…" : "Отменить назначение"}</button></>}>
      <p className={styles.secondaryText}>Прогресс и история выбранных формул будут удалены. При повторном назначении прогресс начнётся с 0/3.</p>
      {mutation.error && <p role="alert" className={styles.error}>{mutation.error}</p>}
    </ManagementModal>}
  </>;
}
