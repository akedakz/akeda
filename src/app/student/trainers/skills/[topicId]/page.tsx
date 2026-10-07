import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageContent, PageHeader, PageShell } from "@/components/page-layout/page-layout";
import BackLink from "@/components/back-link";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { loadStudentSkillAccess } from "@/lib/programs/student-skill-practice";
import SkillPracticeRunner from "./skill-practice-runner";

export const metadata: Metadata = { title: "Навык — AKEDA" };

export default async function StudentSkillPage({ params }: { params: Promise<{ topicId: string }> }) {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (current.profile?.role !== "STUDENT") redirect("/dashboard");

  const { topicId } = await params;
  const access = await loadStudentSkillAccess(current.profile.id, topicId);
  if (!access) notFound();

  return <PageShell>
    <BackLink href="/student/trainers/skills">К навыкам</BackLink>
    <PageHeader title={access.topic.title} description={`${access.program.name} · ${access.section.title}`}/>
    <PageContent>
      <SkillPracticeRunner topicId={topicId} mastered={Boolean(access.completedAt)}/>
    </PageContent>
  </PageShell>;
}
