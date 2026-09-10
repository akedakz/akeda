import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { loadFormulaRecallFormula } from "@/lib/formula-recall/data";
import FormulaRecallEditorForm from "../../formula-editor-form";
import styles from "../../formula-recall.module.css";

export const metadata: Metadata = { title: "Редактирование — Formula Recall" };

export default async function EditFormulaRecallPage({ params }: { params: Promise<{ formulaId: string }> }) {
  const { formulaId } = await params; const current = await getCurrentProfile(); const adminId = current?.profile?.role === "ADMIN" ? current.profile.id : "";
  const data = adminId ? await loadFormulaRecallFormula(adminId, formulaId) : null;
  if (!data || (!data.error && !data.formula)) notFound();
  return <main className={styles.editorPage}><header className={styles.editorHeader}><Link href="/admin/trainers/formula-recall">← Formula Recall</Link><h1>Редактировать формулу</h1><p>Измените запись, тему или способы формулировки вопроса.</p></header>{data.error ? <section className={styles.error}>Не удалось загрузить формулу. Проверьте migration.</section> : data.formula ? <FormulaRecallEditorForm topics={data.topics} formula={data.formula}/> : null}</main>;
}
