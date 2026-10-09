import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type AdminSkillProgramSummary = {
  id: string;
  name: string;
  skillCount: number;
};

export type AdminSkillProgramDetail = {
  id: string;
  name: string;
  sections: {
    id: string;
    title: string;
    skills: { id: string; title: string }[];
  }[];
  skillCount: number;
};

export async function loadAdminSkillPrograms(): Promise<AdminSkillProgramSummary[]> {
  const admin = createAdminClient();
  const [programs, generators] = await Promise.all([
    admin.from("learning_programs").select("id,name").eq("is_active", true).order("name"),
    admin.from("learning_program_skill_generators").select("program_topic_id").eq("is_active", true),
  ]);
  if (programs.error || generators.error) throw new Error("Не удалось загрузить программы навыков.");

  const topicIds = [...new Set((generators.data ?? []).map((item) => item.program_topic_id))];
  if (!topicIds.length) return [];

  const topics = await admin.from("learning_program_topics")
    .select("id,program_id")
    .in("id", topicIds);
  if (topics.error) throw new Error("Не удалось загрузить навыки программ.");

  const counts = new Map<string, number>();
  for (const topic of topics.data ?? []) {
    counts.set(topic.program_id, (counts.get(topic.program_id) ?? 0) + 1);
  }

  return (programs.data ?? [])
    .filter((program) => (counts.get(program.id) ?? 0) > 0)
    .map((program) => ({
      id: program.id,
      name: program.name,
      skillCount: counts.get(program.id) ?? 0,
    }));
}

export async function loadAdminSkillProgram(programId: string): Promise<AdminSkillProgramDetail | null> {
  const admin = createAdminClient();
  const [program, sections, topics] = await Promise.all([
    admin.from("learning_programs").select("id,name").eq("id", programId).eq("is_active", true).maybeSingle(),
    admin.from("learning_program_sections").select("id,title,sort_order")
      .eq("program_id", programId).order("sort_order").order("id"),
    admin.from("learning_program_topics").select("id,title,section_id,sort_order")
      .eq("program_id", programId).order("sort_order").order("id"),
  ]);
  if (program.error || sections.error || topics.error) throw new Error("Не удалось загрузить программу.");
  if (!program.data) return null;

  const topicIds = (topics.data ?? []).map((topic) => topic.id);
  if (!topicIds.length) return { ...program.data, sections: [], skillCount: 0 };

  const generators = await admin.from("learning_program_skill_generators")
    .select("program_topic_id")
    .eq("is_active", true)
    .in("program_topic_id", topicIds);
  if (generators.error) throw new Error("Не удалось загрузить генераторы навыков.");

  const activeIds = new Set((generators.data ?? []).map((generator) => generator.program_topic_id));
  const grouped = (sections.data ?? []).map((section) => ({
    id: section.id,
    title: section.title,
    skills: (topics.data ?? [])
      .filter((topic) => topic.section_id === section.id && activeIds.has(topic.id))
      .map((topic) => ({ id: topic.id, title: topic.title })),
  })).filter((section) => section.skills.length > 0);

  return {
    ...program.data,
    sections: grouped,
    skillCount: grouped.reduce((count, section) => count + section.skills.length, 0),
  };
}
