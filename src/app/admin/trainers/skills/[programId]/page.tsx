import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import BackLink from "@/components/back-link";
import { PageContent, PageHeader, PageShell } from "@/components/page-layout/page-layout";
import { loadAdminSkillProgram } from "@/lib/programs/admin-skill-library";
import styles from "../skills.module.css";

export const metadata: Metadata = { title: "Навыки программы — AKEDA" };

export default async function AdminProgramSkillsPage({
  params,
}: {
  params: Promise<{ programId: string }>;
}) {
  const { programId } = await params;
  const program = await loadAdminSkillProgram(programId);
  if (!program) notFound();

  return <PageShell>
    <BackLink href="/admin/trainers/skills">К программам навыков</BackLink>
    <PageHeader title={program.name}
      description={`Тем: ${program.topicCount} · Активных генераторов: ${program.generatorCount}`}
      actions={<Link className={styles.editLink} href={`/admin/settings/programs/${program.id}`}>Редактировать программу</Link>}
    />
    <PageContent>
      {program.sections.length ? <div className={styles.sections}>
        {program.sections.map((section) => <section key={section.id} className={styles.section}>
          <header className={styles.sectionHeader}>
            <h2>{section.title}</h2>
            <span>Тем: {section.skills.length}</span>
          </header>
          <div className={styles.skills}>
            {section.skills.map((skill) => skill.hasGenerator
              ? <Link key={skill.id}
                  href={`/admin/settings/programs/${program.id}/skills/${skill.id}?from=skills`}
                  className={styles.skillLink}>
                  <span>{skill.title}</span>
                  <strong>Проверить <span aria-hidden="true">→</span></strong>
                </Link>
              : <div key={skill.id} className={styles.skillInactive}>
                  <span>{skill.title}</span>
                  <small>Нет генератора</small>
                </div>
            )}
          </div>
        </section>)}
      </div> : <div className={styles.empty}>
        <h2>В программе пока нет тем</h2>
        <p>Добавьте темы в редакторе программы, чтобы они появились здесь.</p>
      </div>}
    </PageContent>
  </PageShell>;
}
