import ProgramsSettings from "./programs-settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatResultDateLabel } from "@/lib/results/result-date-label";

export default async function ProgramsPage() {
  const admin = createAdminClient();
  const [programs, links, topics] = await Promise.all([
    admin.from("learning_programs").select("id,name,created_at").eq("is_active", true).order("name"),
    admin.from("student_learning_programs").select("program_id"),
    admin.from("learning_program_topics").select("program_id"),
  ]);

  if (programs.error || links.error || topics.error) throw new Error("Не удалось загрузить программы.");

  const studentCounts = new Map<string, number>();
  for (const link of links.data) studentCounts.set(link.program_id, (studentCounts.get(link.program_id) ?? 0) + 1);

  const topicCounts = new Map<string, number>();
  for (const topic of topics.data) topicCounts.set(topic.program_id, (topicCounts.get(topic.program_id) ?? 0) + 1);

  return (
    <ProgramsSettings
      programs={programs.data.map((item) => ({
        id: item.id,
        name: item.name,
        createdLabel: formatResultDateLabel(item.created_at),
        studentCount: studentCounts.get(item.id) ?? 0,
        topicCount: topicCounts.get(item.id) ?? 0,
      }))}
    />
  );
}
