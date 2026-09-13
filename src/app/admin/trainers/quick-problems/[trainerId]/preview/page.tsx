import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TrainerDefinition } from "@/lib/trainers/trainer-import";
import { createQuickProblemPreviewSession } from "@/lib/trainers/quick-problem-runner-server";
import QuickProblemsRunner from "@/app/student/trainers/[assignmentId]/quick-problems-runner";

export const metadata: Metadata = { title: "Предпросмотр Quick Problems — AKEDA" };

export default async function QuickProblemsPreviewPage({ params }: { params: Promise<{ trainerId: string }> }) {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (current.profile?.role !== "ADMIN") redirect("/dashboard");
  const { trainerId } = await params;
  const result = await createAdminClient().from("trainers").select("id,title,definition,content_revision").eq("id", trainerId).eq("owner_admin_id", current.profile.id).eq("type", "QUICK_PROBLEMS").maybeSingle();
  if (result.error || !result.data) notFound();
  const session = createQuickProblemPreviewSession(result.data.id as string, result.data.title as string, result.data.content_revision as number, result.data.definition as TrainerDefinition);
  return <QuickProblemsRunner initial={session} previewMode />;
}
