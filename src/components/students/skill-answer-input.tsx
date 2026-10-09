"use client";

import type { SkillAnswerMeta } from "@/lib/programs/skill-answer-policy";
import styles from "./skill-answer-input.module.css";

export default function SkillAnswerInput({ answerKind, answerHint, value, onChange, disabled, id }: SkillAnswerMeta & {
  value: string; onChange: (value: string) => void; disabled: boolean; id: string;
}) {
  const parts = value.match(/^(.*?) (.*?)\/(.*?)$/);
  const mixed = [parts?.[1] ?? "", parts?.[2] ?? "", parts?.[3] ?? ""];
  const hintId = `${id}-hint`;
  return <div className={styles.wrap}>
    {answerKind === "mixed" ? <div className={styles.mixed} role="group" aria-label="Смешанное число" aria-describedby={hintId}>
      {mixed.map((part, index) => <input key={index} aria-label={["Целая часть", "Числитель", "Знаменатель"][index]}
        inputMode={index === 0 ? "text" : "numeric"} maxLength={24} value={part} disabled={disabled}
        placeholder={["Целая", "Числитель", "Знаменатель"][index]}
        onChange={event => { const next = [...mixed]; next[index] = event.target.value; onChange(`${next[0]} ${next[1]}/${next[2]}`); }} />)}
      <span className={styles.bar} aria-hidden="true" />
    </div> : <input id={id} aria-label="Ответ" aria-describedby={hintId} value={value} disabled={disabled} maxLength={100}
      inputMode={answerKind === "decimal" ? "decimal" : "text"} onChange={event => onChange(event.target.value)}
      placeholder={answerKind === "fraction" ? "Например: 4/5" : answerKind === "sequence" ? "1; 2; 3" : answerKind === "inequality" ? "1 < 2 < 3" : answerKind === "power" ? "3^4" : answerKind === "decimal" ? "Например: 0,4" : "Введите ответ"} />}
    {answerHint && <small id={hintId}>{answerHint}</small>}
  </div>;
}

export function skillAnswerComplete(value: string, kind: SkillAnswerMeta["answerKind"]) {
  return kind === "mixed" ? /^\S+ \S+\/\S+$/.test(value) : Boolean(value.trim());
}
