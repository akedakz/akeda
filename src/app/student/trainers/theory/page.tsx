import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import BackLink from "@/components/back-link";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { TRAINER_TYPE_UI } from "@/lib/trainers/trainer-type-metadata";
import { calculateTheoryOverall, loadTheorySummaries } from "@/lib/trainers/theory-runtime";
import styles from "../trainers.module.css";
import {groupTrainerItems} from "@/lib/trainers/trainer-groups";
import {TrainerGroupSection} from "@/components/trainers/trainer-group-ui";

export const metadata: Metadata = { title: "Theory — AKEDA" };

export default async function StudentTheoryPage({ searchParams }: { searchParams: Promise<{ unavailable?: string }> }) {
  const current = await getCurrentProfile(); if (!current) redirect("/login"); if (current.profile?.role !== "STUDENT") redirect("/dashboard");
  const type = TRAINER_TYPE_UI.THEORY;
  const [data, query] = await Promise.all([loadTheorySummaries(current.profile.id), searchParams]); const overall = calculateTheoryOverall(data.cards);
  const grouped=groupTrainerItems(data.groups??[],data.cards,false);const row=(card:(typeof data.cards)[number])=><article className={`${styles.trainerRow} ${card.kind === "COMPLETED" ? styles.trainerRowCompleted : ""}`} key={card.assignmentId ?? card.completionId}><div className={styles.trainerRowHeading}><h3>{card.title}</h3><p>{card.earned} из {card.required} правильных ответов</p></div><div className={styles.trainerRowProgress}><div className={styles.progress}><i style={{width:`${card.progressPercent}%`}}/></div><strong>{card.progressPercent}%</strong></div>{card.kind === "ACTIVE" && card.assignmentId ? <Link className={styles.continue} href={`/student/trainers/${card.assignmentId}`}>{card.earned ? "Продолжить" : "Начать"}</Link> : <span className={styles.completedAction}>✓ Завершён</span>}</article>;
  return <div className={styles.page}><BackLink href="/student/trainers">Тренажёры</BackLink><header className={`${styles.quickProblemsPageHero} ${styles.theoryPageHero}`}><div className={styles.quickProblemsHeroContent}><span>Тренажёры</span><h1>{type.label}</h1><p>{type.description}</p><div className={styles.overallProgress} aria-label={`Общий прогресс ${overall}%`}><svg aria-hidden="true" viewBox="0 0 120 120"><circle className={styles.overallProgressTrack} cx="60" cy="60" r="52" pathLength="100"/><circle className={styles.overallProgressArc} cx="60" cy="60" r="52" pathLength="100" strokeDasharray="100" strokeDashoffset={100-overall}/></svg><strong>{overall}%</strong></div><b className={styles.overallProgressLabel}>Общий прогресс</b></div></header>{query.unavailable && <p className={styles.notice}>Это прохождение больше недоступно. Список обновлён.</p>}{data.error ? <p className={styles.error}>Не удалось загрузить Theory.</p> : data.cards.length ? <div className={styles.trainerList}>{grouped.map((group,index)=>{const required=group.items.reduce((s,c)=>s+c.required,0);const earned=group.items.reduce((s,c)=>s+c.earned,0);return <TrainerGroupSection key={group.id??"ungrouped"} title={group.title} count={group.items.length} progressPercent={required?Math.round(earned/required*100):0} defaultOpen={index===0}>{group.items.map(row)}</TrainerGroupSection>})}</div> : <section className={`${styles.empty} ${styles.theoryEmpty}`}><p>Пока нет доступных тренажёров.</p></section>}</div>;
}
