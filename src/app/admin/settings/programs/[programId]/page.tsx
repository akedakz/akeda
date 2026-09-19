import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import ProgramEditor from "./program-editor";

export default async function ProgramPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const admin = createAdminClient();

  const program = await admin
    .from("learning_programs")
    .select("id,name")
    .eq("id", programId)
    .eq("is_active", true)
    .maybeSingle();

  if (program.error || !program.data) notFound();

  const [sections, topics] = await Promise.all([
    admin.from("learning_program_sections").select("id,title,sort_order").eq("program_id",programId).order("sort_order").order("id"),
    admin.from("learning_program_topics").select("id,section_id,title,sort_order").eq("program_id",programId).order("sort_order").order("id"),
  ]);

  if (sections.error || topics.error) throw new Error("Не удалось загрузить структуру программы.");

  return (
    <ProgramEditor
      key={`${program.data.name}|${(sections.data ?? []).map((section) => `${section.id}:${section.title}:${section.sort_order}`).join("|")}|${(topics.data ?? []).map((topic) => `${topic.id}:${topic.title}:${topic.sort_order}`).join("|")}`}
      program={program.data}
      initialSections={sections.data ?? []}
      initialTopics={topics.data ?? []}
    />
  );
}
