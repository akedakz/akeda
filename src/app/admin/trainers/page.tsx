import type { Metadata } from "next";
import { PageContent, PageHeader, PageShell } from "@/components/page-layout/page-layout";
import TrainerTypeCard from "@/components/trainers/trainer-type-card";
import { TRAINER_TYPE_UI } from "@/lib/trainers/trainer-type-metadata";
import styles from "./trainers.module.css";

export const metadata: Metadata = { title: "Тренажёры — AKEDA" };

export default function TrainersPage() {
  const quickProblems = TRAINER_TYPE_UI.QUICK_PROBLEMS;
  const theory = TRAINER_TYPE_UI.THEORY;
  const formulaRecall = TRAINER_TYPE_UI.FORMULA_RECALL;
  return <PageShell><PageHeader title="Тренажёры" description="Управление библиотекой тренажёров."/><PageContent><section className={styles.typeGrid}><TrainerTypeCard href={quickProblems.adminHref} label={quickProblems.label} description={quickProblems.description} presentation="quickProblemsHero" adminPicker /><TrainerTypeCard href={theory.adminHref} label={theory.label} description={theory.description} presentation="quickProblemsHero" artwork="theory" adminPicker /><TrainerTypeCard href={formulaRecall.adminHref} label={formulaRecall.label} description={formulaRecall.description} presentation="quickProblemsHero" artwork="formulaRecall" adminPicker /></section></PageContent></PageShell>;
}
