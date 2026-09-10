import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TrainerDefinition } from "@/lib/trainers/trainer-import";
import ConditionEditor from "./condition-editor";

export const metadata: Metadata = { title: "Контент Quick Problems — NSP" };

export default async function QuickProblemsContentPage({ params }: { params: Promise<{ trainerId: string }> }) {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (current.profile?.role !== "ADMIN") redirect("/dashboard");
  const { trainerId } = await params;
  const result = await createAdminClient().from("trainers").select("id,title,definition,content_revision").eq("id", trainerId).eq("owner_admin_id", current.profile.id).eq("type", "QUICK_PROBLEMS").maybeSingle();
  if (result.error || !result.data) notFound();
  return <ConditionEditor trainerId={result.data.id as string} title={result.data.title as string} initialDefinition={result.data.definition as TrainerDefinition} initialRevision={result.data.content_revision as number} />;
}
