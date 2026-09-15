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

  const topics = await admin
    .from("learning_program_topics")
    .select("id,title,sort_order")
    .eq("program_id", programId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });

  if (topics.error) throw new Error("Не удалось загрузить темы программы.");

  return (
    <ProgramEditor
      key={`${program.data.name}|${(topics.data ?? []).map((topic) => `${topic.id}:${topic.title}:${topic.sort_order}`).join("|")}`}
      program={program.data}
      initialTopics={topics.data ?? []}
    />
  );
}
