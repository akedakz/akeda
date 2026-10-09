import type { Metadata } from "next";
import Link from "next/link";
import { PageContent, PageHeader, PageShell } from "@/components/page-layout/page-layout";
import BackLink from "@/components/back-link";
import { loadAdminSkillPrograms } from "@/lib/programs/admin-skill-library";
import styles from "./skills.module.css";

export const metadata: Metadata = { title: "Навыки — AKEDA" };

export default async function AdminSkillsPage() {
  const programs = await loadAdminSkillPrograms();

  return <PageShell>
    <BackLink href="/admin/trainers">К тренажёрам</BackLink>
    <PageHeader title="Навыки" description="Все программы обучения. Выберите программу, чтобы посмотреть и проверить её навыки." />
    <PageContent>
      <div className={styles.programs}>
        {programs.map((program) => <Link key={program.id} href={`/admin/trainers/skills/${program.id}`} className={styles.programCard}>
          <div className={styles.programMain}>
            <h2>{program.name}</h2>
            <p className={styles.programMeta}>Тем: {program.topicCount} · Активных генераторов: {program.generatorCount}</p>
          </div>
          <span className={styles.programAction}>Открыть <span aria-hidden="true">→</span></span>
        </Link>)}
      </div>
      {!programs.length && <div className={styles.empty}>
        <h2>Пока нет программ обучения</h2>
        <p>Создайте программу, чтобы она появилась в списке навыков.</p>
      </div>}
      <p className={styles.footnote}>Здесь показаны все активные программы, включая программы без генераторов. <Link href="/admin/settings/programs">Управлять программами</Link></p>
    </PageContent>
  </PageShell>;
}
