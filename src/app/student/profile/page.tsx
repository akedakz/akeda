import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageContent, PageContentLoading, PageHeader, PageShell } from "@/components/page-layout/page-layout";
import StudentProfilePage from "@/components/student/student-profile-page";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatResultDateLabel } from "@/lib/results/result-date-label";
import { loadStudentLearningProgramProgress } from "@/lib/programs/load-student-program-progress";

export default function ProfilePage() {
  return (
    <PageShell>
      <PageHeader title="Профиль"/>
      <PageContent>
        <Suspense fallback={<PageContentLoading label="Загружаем профиль"/>}>
          <ProfileContent/>
        </Suspense>
      </PageContent>
    </PageShell>
  );
}

async function ProfileContent() {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (current.profile?.role === "ADMIN") redirect("/admin");
  if (current.profile?.role !== "STUDENT") redirect("/dashboard");
  if (current.profile.student_status !== "ACTIVE") return null;

  const admin = createAdminClient();
  const [profileResult, programProgress] = await Promise.all([
    admin
      .from("profiles")
      .select("full_name,email,student_status,created_at")
      .eq("id", current.user.id)
      .eq("role", "STUDENT")
      .single(),
    loadStudentLearningProgramProgress(admin, current.user.id),
  ]);

  if (profileResult.error || programProgress.error) {
    console.error("STUDENT_PROFILE_LOAD", {
      profile: profileResult.error?.message,
      programs: programProgress.error,
    });
    throw new Error("Не удалось загрузить профиль.");
  }

  return (
    <StudentProfilePage
      profile={{
        fullName: profileResult.data.full_name ?? "Ученик",
        email: current.user.email ?? profileResult.data.email ?? "—",
        status: profileResult.data.student_status,
        createdLabel: formatResultDateLabel(profileResult.data.created_at),
        programs: programProgress.programs,
      }}
    />
  );
}
