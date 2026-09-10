"use client";
import { useState } from "react";
import { assignTrainers, deleteCompletedTrainerResult, removeTrainerAssignment, resetTrainerProgress, restartCompletedTheoryTrainer, restartCompletedTrainer } from "@/app/admin/students/[id]/trainer-actions";
import type { AvailableTrainer, TrainerCard } from "@/lib/trainers/trainer-progress";
import { groupTrainerItems, type TrainerGroup } from "@/lib/trainers/trainer-groups";
import { AssignmentModal, TrainerSection, useManagementMutation } from "./trainer-management-ui";
import styles from "./trainer-management.module.css";
const typeLabel = (type: string) => type === "THEORY" ? "Theory" : "Quick Problems";
const dateLabel = (value: string) => new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: "Asia/Almaty" }).format(new Date(value));
export default function StudentTrainersPanel({ studentId, cards, available, groups, loadError }: { studentId: string; cards: TrainerCard[]; available: AvailableTrainer[]; groups: TrainerGroup[]; loadError?: string }) {
  const [modal, setModal] = useState<"QUICK_PROBLEMS" | "THEORY" | null>(null);
  const { pending, error, notice, run } = useManagementMutation();
  const choices = modal ? groupTrainerItems(groups.filter((group) => group.trainerType === modal), [
    ...available.filter((trainer) => trainer.type === modal).map((trainer) => ({ ...trainer, disabledLabel: undefined as string | undefined })),
    ...cards.filter((card) => card.type === modal && (card.kind === "ACTIVE" || card.sourceTrainerId)).map((card) => ({ id: card.kind === "ACTIVE" ? card.trainerId : card.sourceTrainerId!, title: card.title, groupId: card.groupId, disabledLabel: card.kind === "ACTIVE" ? "Уже назначен" : "Уже завершён" })),
  ].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index), false) : [];
  return <>
    {(["QUICK_PROBLEMS", "THEORY"] as const).map((type) => {
      const filtered = cards.filter((card) => card.type === type);
      return <TrainerSection key={type} title={typeLabel(type)} icon={type === "THEORY" ? "▤" : "∑"} count={filtered.filter((card) => card.kind === "ACTIVE").length + " назначено · " + filtered.filter((card) => card.kind === "COMPLETED").length + " завершено"} onAssign={() => setModal(type)}>
        {loadError ? <p className={styles.error}>{loadError}</p> : !filtered.length ? <p className={styles.empty}>Нет назначенных тренажёров</p> : groupTrainerItems(groups.filter((group) => group.trainerType === type), filtered, false).map((group) => {
          const sectionCards = group.items;
          return <section className={styles.group} key={group.id ?? "ungrouped"}><h3>{group.title}</h3>{sectionCards.map((card) => { const required = card.skillsCount * (card.type === "THEORY" ? 3 : 5); return <article className={`${styles.row} `} key={card.kind === "ACTIVE" ? card.assignmentId : card.completionId}><div className={styles.rowCopy}><span>{typeLabel(card.type)}</span><h3>{card.title}</h3>{card.kind === "ACTIVE" ? <><div className={styles.progress}><i style={{ width: `${card.progressPercent}%` }}/></div><small>{card.creditedCorrect} из {required} · {card.progressPercent}% · В процессе</small></> : <small>100% · Завершён {dateLabel(card.completedAt)} · {card.skillsCount} {card.type === "THEORY" ? "вопросов" : "формул"}</small>}</div><div className={styles.actions}>{card.kind === "ACTIVE" ? <>{card.type === "QUICK_PROBLEMS" && <button disabled={pending} onClick={() => { if (window.confirm(`Сбросить прогресс «${card.title}» до 0%?`)) run(() => resetTrainerProgress(studentId, card.assignmentId)); }}>Сбросить прогресс</button>}<button className={styles.danger} disabled={pending} onClick={() => { if (window.confirm(`Удалить назначение «${card.title}»?`)) run(() => removeTrainerAssignment(studentId, card.assignmentId)); }}>Удалить назначение</button></> : <>{card.canRestart && <button disabled={pending} onClick={() => { const confirmed = card.type === "THEORY" ? window.confirm(`Начать «${card.title}» заново?\nТекущий результат 100% будет сброшен.`) : window.confirm(`Удалить завершённый результат и начать «${card.title}» заново?`); if (confirmed) run(() => card.type === "THEORY" ? restartCompletedTheoryTrainer(studentId, card.completionId) : restartCompletedTrainer(studentId, card.completionId)); }}>{card.type === "THEORY" ? "Пройти заново" : "Начать заново"}</button>}<button className={styles.danger} disabled={pending} onClick={() => { if (window.confirm(`Удалить результат «${card.title}»?\nРезультат 100% будет удалён без возможности восстановления.`)) run(() => deleteCompletedTrainerResult(studentId, card.completionId, card.type === "THEORY" ? "THEORY" : "QUICK_PROBLEMS")); }}>Удалить результат</button></>}</div></article>;})}</section>;
        })}
      </TrainerSection>;
    })}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {modal && <AssignmentModal title={"Назначить " + typeLabel(modal)} close={() => setModal(null)} action={(ids) => assignTrainers(studentId, modal, ids)} groups={choices.map((group) => ({ id: group.id ?? "ungrouped", title: group.title, items: group.items.map((item) => ({ id: item.id, content: item.title, disabledLabel: item.disabledLabel })) }))}/>}
  </>;
}
