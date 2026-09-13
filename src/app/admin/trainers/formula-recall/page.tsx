import type { Metadata } from "next";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { loadFormulaRecallLibrary } from "@/lib/formula-recall/data";
import FormulaRecallLibrary from "./formula-recall-library";
import BackLink from "@/components/back-link";
import studentStyles from "@/app/student/trainers/trainers.module.css";

export const metadata: Metadata = { title: "Formula Recall — AKEDA" };

export default async function FormulaRecallPage() {
  const current = await getCurrentProfile();
  const adminId = current?.profile?.role === "ADMIN" ? current.profile.id : "";
  const data = adminId ? await loadFormulaRecallLibrary(adminId) : { topics: [], formulas: [], error: new Error("unauthorized") };
  return <div className={studentStyles.page}><BackLink href="/admin/trainers">К тренажёрам</BackLink><FormulaRecallLibrary topics={data.topics} formulas={data.formulas} loadError={Boolean(data.error)} /></div>;
}
