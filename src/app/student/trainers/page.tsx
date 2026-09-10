import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageContent, PageContentLoading, PageHeader, PageShell } from "@/components/page-layout/page-layout";
import TrainerTypeCard from "@/components/trainers/trainer-type-card";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { loadStudentTrainerTypeSummaries } from "@/lib/trainers/trainer-progress";
import { TRAINER_TYPE_UI } from "@/lib/trainers/trainer-type-metadata";
import styles from "./trainers.module.css";
import { calculateTheoryOverall, loadTheorySummaries } from "@/lib/trainers/theory-runtime";
import { loadFormulaRecallSummary } from "@/lib/formula-recall/runtime-data";
import { countActiveStudentMistakes } from "@/lib/mistakes/runtime";
import { taskCountLabel } from "@/lib/mistakes/labels";

export const metadata: Metadata = { title: "Тренажёры — NSP" };

export default function StudentTrainersPage() { return <PageShell><PageHeader title="Тренажёры" description="Практика по назначенным направлениям."/><PageContent><Suspense fallback={<PageContentLoading label="Загружаем тренажёры"/>}><TrainersContent/></Suspense></PageContent></PageShell>; }
async function TrainersContent() {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (current.profile?.role !== "STUDENT") redirect("/dashboard");
  const quickProblems = TRAINER_TYPE_UI.QUICK_PROBLEMS;
  const theory = TRAINER_TYPE_UI.THEORY;
  const [data, theoryData, formulaRecall, mistakeCount] = await Promise.all([loadStudentTrainerTypeSummaries(current.profile.id), loadTheorySummaries(current.profile.id), loadFormulaRecallSummary(current.profile.id), countActiveStudentMistakes(current.profile.id)]);
  const progressPercent = data.summaries.find((summary) => summary.type === "QUICK_PROBLEMS")?.progressPercent ?? 0;
  const formula = TRAINER_TYPE_UI.FORMULA_RECALL;
  return <section className={styles.typePicker}><TrainerTypeCard href="/student/trainers/mistakes" label="Mistake Review" description="Повторите вопросы, в которых были ошибки." metricLabel={taskCountLabel(mistakeCount)} presentation="quickProblemsHero" artwork="mistakes" studentPicker /><TrainerTypeCard href={quickProblems.studentHref} label={quickProblems.label} description={quickProblems.description} progressPercent={progressPercent} presentation="quickProblemsHero" studentPicker /><TrainerTypeCard href={theory.studentHref} label={theory.label} description={theory.description} progressPercent={calculateTheoryOverall(theoryData.cards)} presentation="quickProblemsHero" artwork="theory" studentPicker /><TrainerTypeCard href={formula.studentHref} label={formula.label} description={formula.description} progressPercent={formulaRecall.summary.progressPercent} presentation="quickProblemsHero" artwork="formulaRecall" studentPicker /></section>;
}
