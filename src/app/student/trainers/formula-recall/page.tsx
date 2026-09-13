import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import BackLink from "@/components/back-link";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { loadFormulaRecallSummary } from "@/lib/formula-recall/runtime-data";
import styles from "./formula-recall.module.css";
import trainerStyles from "../trainers.module.css";
import MasteredFormulas from "./mastered-formulas";

export const metadata: Metadata = { title: "Formula Recall — AKEDA" };

export default async function FormulaRecallHomePage() {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (current.profile?.role !== "STUDENT") redirect("/dashboard");
  const { summary, error } = await loadFormulaRecallSummary(current.profile.id);
  const masteredCount = summary.masteredTopics.reduce((count, topic) => count + topic.formulas.length, 0);
  return <main className={trainerStyles.page}><BackLink href="/student/trainers">Тренажёры</BackLink><header className={`${trainerStyles.quickProblemsPageHero} ${trainerStyles.formulaRecallPageHero}`}><div className={trainerStyles.quickProblemsHeroContent}><span>Тренажёры</span><h1>Formula Recall</h1><p>Повторяйте и закрепляйте формулы по всем темам</p><div className={trainerStyles.overallProgress} aria-label={`Общий прогресс ${summary.progressPercent}%`}><svg aria-hidden="true" viewBox="0 0 120 120"><circle className={trainerStyles.overallProgressTrack} cx="60" cy="60" r="52" pathLength="100"/><circle className={trainerStyles.overallProgressArc} cx="60" cy="60" r="52" pathLength="100" strokeDasharray="100" strokeDashoffset={100-summary.progressPercent}/></svg><strong>{summary.progressPercent}%</strong></div><b className={trainerStyles.overallProgressLabel}>Общий прогресс</b></div></header><section className={styles.home}>
    {error ? <section className={styles.empty}>Не удалось загрузить Formula Recall.</section> : summary.assignedCount === 0 ? <section className={styles.empty}><p>Преподаватель пока не назначил вам формулы</p></section> : <>
      <section className={styles.overall}><div><span>Общий прогресс</span><strong>{summary.progressPercent}%</strong><p>{masteredCount} из {summary.assignedCount} формул освоено</p></div><div className={styles.overallActions}>{!summary.allMastered && <Link href="/student/trainers/formula-recall/practice">Продолжить тренировку</Link>}<MasteredFormulas topics={summary.masteredTopics}/></div></section>
      <section className={styles.topicList}>{summary.topics.map((topic) => <article className={topic.progressPercent === 100 ? styles.topicComplete : ""} key={topic.id}><div><h3>{topic.title}</h3><strong>{topic.progressPercent}%</strong></div><div className={styles.topicProgress}><i style={{ width: `${topic.progressPercent}%` }}/></div></article>)}</section>
    </>}
  </section></main>;
}
