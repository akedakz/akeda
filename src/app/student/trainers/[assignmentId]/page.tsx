import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { issueNormalTaskBatch } from "@/lib/trainers/quick-problem-runner-server";
import QuickProblemsRunner from "./quick-problems-runner";
import TheoryRunner from "./theory-runner";
import { createAdminClient } from "@/lib/supabase/admin";
import { issueTheoryQuestion } from "@/lib/trainers/theory-runtime";

export const metadata: Metadata = { title: "Тренажёр — NSP" };
export default async function TrainerRunnerPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const current = await getCurrentProfile(); if (!current) redirect("/login"); if (current.profile?.role !== "STUDENT") redirect("/dashboard");
  if (current.profile.student_status !== "ACTIVE") redirect("/dashboard");
  const { assignmentId } = await params;
  const assignment = await createAdminClient().from("trainer_assignments").select("trainer:trainers!inner(type)").eq("id", assignmentId).eq("student_id", current.profile.id).maybeSingle();
  const type = (assignment.data?.trainer as unknown as { type?: string } | null)?.type;
  if (type === "THEORY") { const session = await issueTheoryQuestion(current.profile.id, assignmentId); if (!session) redirect("/student/trainers/theory?unavailable=1"); return <TheoryRunner initial={session}/>; }
  const session = await issueNormalTaskBatch(current.profile.id, assignmentId);
  if (!session || "status" in session) redirect("/student/trainers/quick-problems?unavailable=1");
  return <QuickProblemsRunner initial={session} />;
}
