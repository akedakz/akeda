"use client";

import { useEffect, useRef, useState } from "react";
import MathText from "@/components/tests/math-text";
import type { FormulaRecallMasteredTopic } from "@/lib/formula-recall/runtime-types";
import styles from "./formula-recall.module.css";

export default function MasteredFormulas({ topics }: { topics: FormulaRecallMasteredTopic[] }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const close = () => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()); };

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => dialog.current?.querySelector<HTMLButtonElement>("button")?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab" || !dialog.current) return;
      const nodes = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]')];
      if (!nodes.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", keydown); };
  }, [open]);

  return <><button ref={trigger} className={styles.masteredButton} type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>Изученные формулы</button>{open && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section ref={dialog} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="mastered-formulas-title" aria-describedby="mastered-formulas-description"><header><div><h2 id="mastered-formulas-title">Изученные формулы</h2><p id="mastered-formulas-description">Формулы, которые вы уже освоили.</p></div><button type="button" aria-label="Закрыть" onClick={close}>×</button></header>{topics.length ? <div className={styles.masteredTopics}>{topics.map((topic) => <section key={topic.id}><h3>{topic.title}</h3><div>{topic.formulas.map((formula) => <div className={styles.formulaRow} key={formula.id}><span aria-hidden="true">✓</span><MathText>{`$${formula.expression}$`}</MathText></div>)}</div></section>)}</div> : <div className={styles.masteredEmpty}><strong>Пока нет изученных формул.</strong><p>Продолжайте тренировку — освоенные формулы появятся здесь.</p></div>}</section></div>}</>;
}
