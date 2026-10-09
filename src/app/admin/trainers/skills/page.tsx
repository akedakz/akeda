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
    <PageHeader title="Навыки" description="Выберите программу, чтобы проверить генераторы заданий." />
    <PageContent>
      <div className={styles.programs}>
        {programs.map((program) => <Link key={program.id} href={`/admin/trainers/skills/${program.id}`} className={styles.programCard}>
          <span className={styles.eyebrow}>Программа обучения</span>
          <h2>{program.name}</h2>
          <div className={styles.programFooter}>
            <span>{program.skillCount} {program.skillCount % 10 === 1 && program.skillCount % 100 !== 11 ? "навык" : [2,3,4].includes(program.skillCount % 10) && !(program.skillCount % 100 >= 12 && program.skillCount % 100 <= 14) ? "навыка" : "навыков"} с генераторами</span>
            <strong>Открыть <span aria-hidden="true">→</span></strong>
          </div>
        </Link>)}
      </div>
      {!programs.length && <div className={styles.empty}>
        <h2>Пока нет активных генераторов</h2>
        <p>Как только в программу будут добавлены генераторы навыков, она появится здесь.</p>
      </div>}
      <p className={styles.footnote}>Программы без активных генераторов здесь не отображаются. <Link href="/admin/settings/programs">Редактировать программы</Link></p>
    </PageContent>
  </PageShell>;
}
