import BackLink from "@/components/back-link";
import styles from "../formula-recall.module.css";
import runnerStyles from "../../[assignmentId]/runner.module.css";

export default function FormulaRecallPracticeLoading() {
  return <main className={`${runnerStyles.runner} ${styles.practice}`}><header><BackLink href="/student/trainers/formula-recall">К Formula Recall</BackLink><div><h1>Formula Recall</h1></div><div className={runnerStyles.overall}><i style={{ width: "0%" }}/></div></header><section className={`${runnerStyles.task} ${styles.taskCard} ${styles.loadingCard}`} role="status" aria-live="polite" aria-label="Загружаем задание"><span aria-hidden="true"/><small>Загружаем задание</small></section></main>;
}
