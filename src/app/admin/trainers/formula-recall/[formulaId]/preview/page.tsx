import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import MathText from "@/components/tests/math-text";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { loadFormulaRecallFormula } from "@/lib/formula-recall/data";
import FormulaRecallPreview from "./formula-recall-preview";
import styles from "../../formula-recall.module.css";

export const metadata: Metadata = { title: "Предпросмотр — Formula Recall" };

export default async function PreviewFormulaRecallPage({ params }: { params: Promise<{ formulaId: string }> }) {
  const { formulaId } = await params; const current = await getCurrentProfile(); const adminId = current?.profile?.role === "ADMIN" ? current.profile.id : "";
  const data = adminId ? await loadFormulaRecallFormula(adminId, formulaId) : null;
  if (!data || (!data.error && !data.formula)) notFound();
  return <main className={styles.previewShell}><header className={styles.editorHeader}><Link href="/admin/trainers/formula-recall">← Formula Recall</Link><h1>Предпросмотр</h1><p>Так может выглядеть вопрос для ученика.</p></header>{data.error ? <section className={styles.error}>Не удалось загрузить формулу.</section> : data.formula ? <><div className={styles.canonicalPreview}><MathText>{`$$${data.formula.canonicalExpression}$$`}</MathText></div><FormulaRecallPreview formula={data.formula}/></> : null}</main>;
}
