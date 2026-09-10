import Link from "next/link";
import styles from "./trainer-type-card.module.css";

type TrainerTypeCardProps = {
  href: string;
  label: string;
  description: string;
  progressPercent?: number;
  metricLabel?: string;
  presentation?: "default" | "quickProblemsHero";
  artwork?: "quickProblems" | "theory" | "formulaRecall" | "mistakes";
  studentPicker?: boolean;
  adminPicker?: boolean;
};

export default function TrainerTypeCard({ href, label, description, progressPercent, metricLabel, presentation = "default", artwork = "quickProblems", studentPicker = false, adminPicker = false }: TrainerTypeCardProps) {
  const [metricValue, ...metricWords] = metricLabel?.split(" ") ?? [];
  const className = presentation === "quickProblemsHero"
    ? `${styles.card} ${styles.quickProblemsHero} ${artwork === "theory" ? styles.theoryHero : artwork === "formulaRecall" ? styles.formulaRecallHero : artwork === "mistakes" ? styles.mistakesHero : styles.quickProblemsArtwork}${studentPicker ? ` ${styles.studentTrainerHero}` : ""}${adminPicker ? ` ${styles.adminTrainerHero}` : ""}${progressPercent === undefined && !adminPicker && !studentPicker ? ` ${styles.quickProblemsHeroCompact}` : ""}`
    : styles.card;

  return <Link className={className} href={href}><h2>{label}</h2>{!studentPicker && !adminPicker && <p>{description}</p>}{metricLabel && <strong className={styles.metric}><span className={styles.metricValue}>{metricValue}</span><span className={styles.metricWord}>{metricWords.join(" ")}</span></strong>}{progressPercent !== undefined && <div className={styles.progress}><div><span>Общий прогресс</span><strong>{progressPercent}%</strong></div><i aria-hidden="true"><b style={{ width: `${progressPercent}%` }} /></i></div>}</Link>;
}
