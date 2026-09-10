"use client";

import { useState, useTransition } from "react";
import FormulaEditor from "@/components/formula-editor/formula-editor";
import type { FormulaRecallFormula } from "@/lib/formula-recall/types";
import { checkFormulaRecallPreviewAnswer, type FormulaRecallCheckActionResult } from "../../actions";
import styles from "../../formula-recall.module.css";
import previewStyles from "./preview.module.css";

export default function FormulaRecallPreview({ formula }: { formula: FormulaRecallFormula }) {
  const [conditionIndex, setConditionIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<FormulaRecallCheckActionResult | null>(null);
  const [isChecking, startChecking] = useTransition();
  const condition = formula.conditions[conditionIndex] ?? formula.conditions[0];

  function updateAnswer(value: string) { setAnswer(value); setResult(null); }
  function checkAnswer() { startChecking(async () => setResult(await checkFormulaRecallPreviewAnswer(formula.id, answer))); }
  function nextCondition() {
    setConditionIndex((index) => (index + 1) % formula.conditions.length);
    setAnswer("");
    setResult(null);
  }

  return <section className={styles.previewCard}>
    <span>Formula Recall</span>
    <h1>Вспомните формулу</h1>
    <p>{condition.text}</p>
    <FormulaEditor value={answer} onChange={updateAnswer} allowPaste={false} maxExpressionLength={250}/>
    <div className={previewStyles.checkRow}>
      <button className={styles.primaryButton} type="button" disabled={isChecking || !answer.trim()} onClick={checkAnswer}>{isChecking ? "Проверяем…" : "Проверить"}</button>
      {result ? <div className={result.correct ? previewStyles.checkCorrect : previewStyles.checkWrong} role="status"><strong>{result.message}</strong><small>Диагностика: {result.reason}</small></div> : null}
    </div>
    <div className={styles.previewTools}>
      <button type="button" disabled={formula.conditions.length < 2} onClick={nextCondition}>Другое условие</button>
      <small>{conditionIndex + 1} из {formula.conditions.length}</small>
    </div>
    <p className={styles.previewNote}>Административный предпросмотр проверяет ответ, но не сохраняет прогресс.</p>
  </section>;
}
