import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { loadFormulaRecallTopics } from "@/lib/formula-recall/data";
import FormulaRecallBatchCreateForm from "../formula-batch-create-form";
import styles from "../formula-recall.module.css";

export const metadata: Metadata = { title: "Новая формула — Formula Recall" };

export default async function NewFormulaRecallPage() {
  const current = await getCurrentProfile(); const adminId = current?.profile?.role === "ADMIN" ? current.profile.id : "";
  const data = adminId ? await loadFormulaRecallTopics(adminId) : { topics: [], error: new Error("unauthorized") };
  return <main className={styles.editorPage}><header className={styles.editorHeader}><Link href="/admin/trainers/formula-recall">← Formula Recall</Link><h1>Новые формулы</h1><p>Добавьте одну или несколько формул в общую тему.</p></header>{data.error ? <section className={styles.error}>Не удалось загрузить темы. Проверьте migration.</section> : data.topics.length ? <FormulaRecallBatchCreateForm topics={data.topics} initialDraftId={randomUUID()} initialConditionIds={[randomUUID(), randomUUID(), randomUUID()]}/> : <section className={styles.empty}><h2>Сначала создайте тему</h2><p>Формула должна относиться к теме.</p><Link className={styles.primaryButton} href="/admin/trainers/formula-recall">Вернуться в библиотеку</Link></section>}</main>;
}
