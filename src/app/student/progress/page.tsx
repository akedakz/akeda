import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageContent, PageContentLoading, PageHeader, PageShell } from "@/components/page-layout/page-layout";
import StudentProgressPage from "@/components/student/progress/student-progress-page";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { loadStudentProgressByStudentId } from "@/lib/progress/student-progress";
import styles from "./page.module.css";

export default function ProgressPage() { return <PageShell><PageHeader title="Мой прогресс" description="Темы, уроки, задания, тесты и тренажёры."/><PageContent className={styles.progressContent}><Suspense fallback={<PageContentLoading label="Загружаем прогресс"/>}><ProgressContent/></Suspense></PageContent></PageShell>; }
async function ProgressContent() {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (current.profile?.role === "ADMIN") redirect("/admin");
  if (current.profile?.role !== "STUDENT") redirect("/dashboard");
  if (current.profile.student_status !== "ACTIVE") return null;
  const data = await loadStudentProgressByStudentId(current.user.id);
  return <StudentProgressPage data={data} showHeader={false}/>;
}
