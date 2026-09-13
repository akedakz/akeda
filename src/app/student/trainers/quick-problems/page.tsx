import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import BackLink from "@/components/back-link";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { calculateTrainerTypeProgress, loadTrainerCards, type TrainerCard } from "@/lib/trainers/trainer-progress";
import { TRAINER_TYPE_UI } from "@/lib/trainers/trainer-type-metadata";
import styles from "../trainers.module.css";
import {groupTrainerItems} from "@/lib/trainers/trainer-groups";
import {TrainerGroupSection} from "@/components/trainers/trainer-group-ui";

export const metadata: Metadata = { title: "Quick Problems — AKEDA" };

export default async function StudentQuickProblemsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (current.profile?.role !== "STUDENT") redirect("/dashboard");
  const [data, query] = await Promise.all([loadTrainerCards(current.profile.id), searchParams]);
  const cards = data.cards.filter((card) => card.type === "QUICK_PROBLEMS");
  const { progressPercent } = calculateTrainerTypeProgress(cards, "QUICK_PROBLEMS");
  const type = TRAINER_TYPE_UI.QUICK_PROBLEMS;
  const grouped=groupTrainerItems(data.groups??[],cards,false);
  const row=(card:TrainerCard)=><article className={`${styles.trainerRow} ${card.kind === "COMPLETED" ? styles.trainerRowCompleted : ""}`} key={card.kind === "ACTIVE" ? card.assignmentId : card.completionId}><div className={styles.trainerRowHeading}><h3>{card.title}</h3><p>{card.kind === "ACTIVE" ? `${card.creditedCorrect} из ${card.skillsCount * 5}` : `${card.skillsCount * 5} из ${card.skillsCount * 5}`} самостоятельных решений</p></div><div className={styles.trainerRowProgress}><div className={styles.progress}><i style={{ width: `${card.progressPercent}%` }}/></div><strong>{card.progressPercent}%</strong></div>{card.kind === "ACTIVE" ? <Link className={styles.continue} href={`/student/trainers/${card.assignmentId}`}>Продолжить</Link> : <span className={styles.completedAction}>✓ Завершён</span>}</article>;
  return <div className={styles.page}><BackLink href="/student/trainers">Тренажёры</BackLink><header className={styles.quickProblemsPageHero}><div className={styles.quickProblemsHeroContent}><span>Тренажёры</span><h1>{type.label}</h1><p>{type.description}</p><div className={styles.overallProgress} aria-label={`Общий прогресс ${progressPercent}%`}><svg aria-hidden="true" viewBox="0 0 120 120"><circle className={styles.overallProgressTrack} cx="60" cy="60" r="52" pathLength="100"/><circle className={styles.overallProgressArc} cx="60" cy="60" r="52" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - progressPercent}/></svg><strong>{progressPercent}%</strong></div><b className={styles.overallProgressLabel}>Общий прогресс</b></div></header>{query.unavailable && <p className={styles.notice}>Этот тренажёр больше недоступен. Список уже обновлён.</p>}{data.error ? <p className={styles.error}>Не удалось загрузить тренажёры.</p> : cards.length ? <div className={styles.trainerList}>{grouped.map((group,index)=>{const required=group.items.reduce((s,c)=>s+c.skillsCount*5,0);const earned=group.items.reduce((s,c)=>s+(c.kind==="COMPLETED"?c.skillsCount*5:c.creditedCorrect),0);const percent=required?Math.round(earned/required*100):0;return <TrainerGroupSection key={group.id??"ungrouped"} title={group.title} count={group.items.length} progressPercent={percent} defaultOpen={index===0}>{group.items.map(row)}</TrainerGroupSection>})}</div> : <section className={styles.empty}><p>Пока нет доступных тренажёров.</p></section>}</div>;
}
