import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { loadActiveFormulaRecallTask, loadFormulaRecallSummary } from "@/lib/formula-recall/runtime-data";
import FormulaRecallPractice from "./formula-recall-practice";

export const metadata: Metadata = { title: "Практика Formula Recall — AKEDA" };

export default async function FormulaRecallPracticePage({ searchParams }: { searchParams: Promise<{ topic?: string }> }) {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (current.profile?.role !== "STUDENT") redirect("/dashboard");
  const [{ topic }, task, summary] = await Promise.all([searchParams, loadActiveFormulaRecallTask(current.profile.id), loadFormulaRecallSummary(current.profile.id)]);
  return <FormulaRecallPractice initialTask={task} initialSummary={summary.summary} topicId={typeof topic === "string" ? topic : null}/>;
}
