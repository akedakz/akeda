import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import BackLink from "@/components/back-link";
import { PageContent, PageContentLoading, PageHeader, PageShell } from "@/components/page-layout/page-layout";
import StudentPageTabs from "@/components/students/student-page-tabs";
import { parseStudentTab } from "@/components/students/student-tab-types";
import UserAvatar from "@/components/user-avatar";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminStudentAvatarUrl } from "@/lib/avatars/student-avatar";
import { createAdminClient } from "@/lib/supabase/admin";
import { preloadAdminStudentTrainerReadModel } from "@/lib/trainers/admin-student-read-model";
import type { StudentStatus } from "@/types/profile";
import StudentTabContent from "./student-tab-content";
import styles from "./student.module.css";

export const metadata: Metadata = { title: "Страница ученика — NSP" };

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type StudentProfile = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: "STUDENT";
  created_at: string;
  student_status: StudentStatus | null;
  avatar_path: string | null;
};

const statusLabels: Record<StudentStatus, string> = {
  ACTIVE: "Активен",
  PAUSED: "Приостановлен",
  ARCHIVED: "Архивный",
};

export default async function StudentPage({ params, searchParams }: PageProps) {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (current.profile?.role !== "ADMIN") redirect("/dashboard");

  const [{ id }, query] = await Promise.all([params, searchParams]);
  const activeTab = parseStudentTab(query.tab);
  const admin = createAdminClient();
  const { data, error } = await admin.from("profiles").select("id, full_name, email, role, created_at, student_status, avatar_path").eq("id", id).eq("role", "STUDENT").maybeSingle();
  if (error || !data) notFound();

  const student = data as StudentProfile;
  if (activeTab === "trainers") preloadAdminStudentTrainerReadModel(student.id, current.profile.id);
  const studentAvatarUrl = await createAdminStudentAvatarUrl(student.avatar_path);
  const currentStatusLabel = student.student_status ? statusLabels[student.student_status] : "Не указан";

  return <PageShell>
    <div className={styles.backLink}><BackLink href="/admin/students">Назад к ученикам</BackLink></div>
    <PageHeader title={student.full_name ?? "Без имени"} description={`${student.email ?? "Email не указан"} · ${currentStatusLabel}`}/>
    <PageContent>
      <div className={styles.compactHeader} style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <UserAvatar name={student.full_name} avatarUrl={studentAvatarUrl} size={88}/>
      </div>
      <StudentPageTabs studentId={student.id} activeTab={activeTab}>
        <Suspense key={activeTab} fallback={<PageContentLoading label="Загрузка раздела ученика"/>}>
          <StudentTabContent student={student} adminId={current.profile.id} activeTab={activeTab} query={query}/>
        </Suspense>
      </StudentPageTabs>
    </PageContent>
  </PageShell>;
}
