import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TheoryDefinition, TheoryStatus } from "@/lib/trainers/theory-types";
import TheoryEditor from "./theory-editor";

export const metadata: Metadata = { title: "Редактор Theory — AKEDA" };
type Row = { id: string; title: string; status: TheoryStatus; definition: TheoryDefinition; content_revision: number; updated_at: string };

export default async function TheoryEditorPage({ params }: { params: Promise<{ trainerId: string }> }) {
  const { trainerId } = await params; const current = await getCurrentProfile();
  if (!current || current.profile?.role !== "ADMIN") notFound();
  const result = await createAdminClient().from("trainers").select("id,title,status,definition,content_revision,updated_at").eq("id", trainerId).eq("owner_admin_id", current.profile.id).eq("type", "THEORY").maybeSingle();
  if (result.error || !result.data) notFound();
  const row = result.data as Row;
  return <TheoryEditor initial={{ id: row.id, title: row.title, status: row.status, definition: row.definition, contentRevision: row.content_revision, updatedAt: row.updated_at }}/>;
}
