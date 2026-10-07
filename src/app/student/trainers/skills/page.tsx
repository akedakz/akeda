import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageContent, PageHeader, PageShell } from "@/components/page-layout/page-layout";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { loadStudentSkillLibrary } from "@/lib/programs/student-skill-practice";
import styles from "./skills.module.css";

export const metadata: Metadata = { title: "Навыки — AKEDA" };

export default async function StudentSkillsPage() {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (current.profile?.role !== "STUDENT") redirect("/dashboard");

  const library = await loadStudentSkillLibrary(current.profile.id);

  return <PageShell>
    <PageHeader title="Навыки" description="Практика по навыкам вашей программы обучения."/>
    <PageContent>
      {!library.total ? <section className={styles.empty}><h2>Навыки пока не назначены</h2><p>Здесь появятся навыки из вашей программы обучения.</p></section> : <>
        <section className={styles.summary}>
          <div><span>Освоено</span><strong>{library.completed} из {library.total}</strong></div>
          <div><span>Прогресс</span><strong>{library.percent}%</strong></div>
        </section>
        <div className={styles.programs}>
          {library.programs.map((program) => <section className={styles.program} key={program.id}>
            <header><span>Программа обучения</span><h2>{program.name}</h2></header>
            {program.sections.map((section) => <div className={styles.section} key={section.id}>
              <h3>{section.title}</h3>
              <div className={styles.grid}>
                {section.skills.map((skill) => <Link className={styles.skill} data-completed={skill.completedAt ? true : undefined} href={`/student/trainers/skills/${skill.id}`} key={skill.id}>
                  <span className={styles.status}>{skill.completedAt ? "✓" : "●"}</span>
                  <div><strong>{skill.title}</strong><small>{skill.completedAt ? "Освоен" : "В процессе"}</small></div>
                  <b>{skill.completedAt ? "Повторить" : "Начать"}</b>
                </Link>)}
              </div>
            </div>)}
          </section>)}
        </div>
      </>}
    </PageContent>
  </PageShell>;
}
