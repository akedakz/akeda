"use client";

import { useState, useTransition } from "react";
import BackLink from "@/components/back-link";
import MathText from "@/components/tests/math-text";
import type { GeneratedProblem, TrainerDefinition, TrainerVariant } from "@/lib/trainers/trainer-import";
import { addCondition, deleteCondition, previewCondition, updateCondition } from "./actions";
import styles from "./editor.module.css";

type Selection = { skillKey: string; variantKey: string; promptIndex: number; formula: string; prompt: string; add?: boolean };

function VariableSummary({ variant }: { variant: TrainerVariant }) {
  const ranged = variant.variables.filter((item) => item.kind === "RANDOM_INT");
  if (!ranged.length) return null;
  return <div className={styles.variables}>{ranged.map((item) => <span key={item.name}><strong>{item.name}</strong>: {item.min}–{item.max}</span>)}</div>;
}

export default function ConditionEditor({ trainerId, title, initialDefinition, initialRevision }: { trainerId: string; title: string; initialDefinition: TrainerDefinition; initialRevision: number }) {
  const [definition, setDefinition] = useState(initialDefinition);
  const [openSkills, setOpenSkills] = useState(() => new Set(initialDefinition.skills[0] ? [initialDefinition.skills[0].key] : []));
  const [revision, setRevision] = useState(initialRevision);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState<GeneratedProblem | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const conditionCount = definition.skills.reduce((total, skill) => total + skill.variants.reduce((sum, variant) => sum + variant.prompts.length, 0), 0);

  const target = (item: Selection) => ({ trainerId, expectedRevision: revision, skillKey: item.skillKey, variantKey: item.variantKey });
  const open = (item: Selection) => { setSelection(item); setDraft(item.prompt); setPreview(null); setError(""); };
  const close = () => { if (!pending) { setSelection(null); setPreview(null); setError(""); } };
  const updateLocal = (item: Selection, nextPrompt?: string) => setDefinition((current) => ({ ...current, skills: current.skills.map((skill) => skill.key !== item.skillKey ? skill : { ...skill, variants: skill.variants.map((variant) => variant.key !== item.variantKey ? variant : { ...variant, prompts: item.add ? [...variant.prompts, nextPrompt!] : nextPrompt === undefined ? variant.prompts.filter((_, index) => index !== item.promptIndex) : variant.prompts.map((prompt, index) => index === item.promptIndex ? nextPrompt : prompt) }) }) }));

  const save = () => {
    if (!selection) return;
    startTransition(async () => {
      const result = selection.add ? await addCondition(target(selection), draft) : await updateCondition(target(selection), selection.promptIndex, draft);
      if (!result.ok) { setError(result.message); return; }
      updateLocal(selection, draft.trim()); setRevision(result.revision); close();
    });
  };
  const remove = (item: Selection) => {
    if (!window.confirm("Удалить это условие? Уже выданные задачи останутся без изменений.")) return;
    startTransition(async () => {
      const result = await deleteCondition(target(item), item.promptIndex);
      if (!result.ok) { setError(result.message); return; }
      updateLocal(item); setRevision(result.revision); setError("");
    });
  };
  const showPreview = (item: Selection, prompt: string) => startTransition(async () => {
    setError(""); setPreview(null);
    const result = await previewCondition(target(item), prompt);
    if (result.ok) setPreview(result.problem); else setError(result.message);
  });
  const openPreview = (item: Selection) => {
    open(item);
    startTransition(async () => {
      const result = await previewCondition(target(item), item.prompt);
      if (result.ok) setPreview(result.problem); else setError(result.message);
    });
  };

  return <main className={styles.page}>
    <BackLink href="/admin/trainers/quick-problems">Quick Problems</BackLink>
    <header className={styles.header}><span>Контент тренажёра</span><h1>{title}</h1><p>{definition.skills.length} формул · {conditionCount} условий</p></header>
    {error && !selection && <p className={styles.pageError} role="alert">{error}</p>}
    <section className={styles.skills}>{definition.skills.map((skill) => {
      const count = skill.variants.reduce((sum, variant) => sum + variant.prompts.length, 0);
      return <details className={styles.skill} key={skill.key} open={openSkills.has(skill.key)} onToggle={(event) => { const isOpen = event.currentTarget.open; setOpenSkills((current) => { const next = new Set(current); if (isOpen) next.add(skill.key); else next.delete(skill.key); return next; }); }}>
        <summary><div><span>{skill.name}</span><MathText className={styles.formula}>{`$$${skill.formulaLatex}$$`}</MathText></div><strong>{count} {count === 1 ? "условие" : count < 5 ? "условия" : "условий"}</strong></summary>
        <div className={styles.skillBody}>{skill.variants.map((variant) => <section className={styles.variant} key={variant.key}>
          <div className={styles.variantHeading}><div><h2>Найти {variant.answerVariable}</h2><p>Ответ в {variant.answerUnit}</p></div><button onClick={() => open({ skillKey: skill.key, variantKey: variant.key, promptIndex: variant.prompts.length, formula: skill.formulaLatex, prompt: "", add: true })}>+ Условие</button></div>
          <VariableSummary variant={variant} />
          <div className={styles.cards}>{variant.prompts.map((prompt, promptIndex) => {
            const item = { skillKey: skill.key, variantKey: variant.key, promptIndex, formula: skill.formulaLatex, prompt };
            return <article className={styles.card} key={`${variant.key}-${promptIndex}`}><p>{prompt}</p><div className={styles.cardActions}><button onClick={() => open(item)}>Изменить</button><button onClick={() => openPreview(item)}>Предпросмотр</button><button className={styles.danger} disabled={pending} onClick={() => remove(item)}>Удалить</button></div></article>;
          })}</div>
        </section>)}</div>
      </details>;
    })}</section>
    {selection && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><aside className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="condition-editor-title">
      <header><div><span>{selection.add ? "Новое условие" : "Редактирование условия"}</span><h2 id="condition-editor-title">{selection.add ? "Добавить условие" : "Условие задачи"}</h2></div><button className={styles.close} onClick={close} aria-label="Закрыть">×</button></header>
      <label>Формула <MathText className={styles.readonlyFormula}>{`$$${selection.formula}$$`}</MathText><small>Формула доступна только для чтения</small></label>
      <label>Условие<textarea autoFocus value={draft} maxLength={1000} onChange={(event) => { setDraft(event.target.value); setPreview(null); setError(""); }} placeholder="Введите текст условия. Переменные указываются как {{name}}." /></label>
      {error && <p className={styles.drawerError} role="alert">{error}</p>}
      <div className={styles.drawerActions}><button onClick={() => showPreview(selection, draft)} disabled={pending || !draft.trim()}>{pending ? "Готовим…" : "Предпросмотр"}</button><span/><button onClick={close} disabled={pending}>Отмена</button><button className={styles.save} onClick={save} disabled={pending || !draft.trim()}>{pending ? "Сохраняем…" : "Сохранить"}</button></div>
      {preview && <section className={styles.preview}><span>Предпросмотр</span><p>{preview.prompt}</p><div><strong>Ответ: {preview.answer} {preview.answerUnit}</strong><button onClick={() => showPreview(selection, draft)} disabled={pending}>Другой пример</button></div></section>}
    </aside></div>}
  </main>;
}
