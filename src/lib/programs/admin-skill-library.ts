import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type AdminSkillProgramSummary = {
  id: string;
  name: string;
  topicCount: number;
  generatorCount: number;
};

export type AdminSkillProgramDetail = {
  id: string;
  name: string;
  sections: {
    id: string;
    title: string;
    skills: { id: string; title: string; hasGenerator: boolean }[];
  }[];
  topicCount: number;
  generatorCount: number;
};

export async function loadAdminSkillPrograms(): Promise<AdminSkillProgramSummary[]> {
  const admin = createAdminClient();
  const [programs, topics, generators] = await Promise.all([
    admin.from("learning_programs").select("id,name").eq("is_active", true).order("name"),
    admin.from("learning_program_topics").select("id,program_id"),
    admin.from("learning_program_skill_generators").select("program_topic_id").eq("is_active", true),
  ]);
  if (programs.error || topics.error || generators.error) throw new Error("Не удалось загрузить программы навыков.");

  const activeGeneratorIds = new Set((generators.data ?? []).map((item) => item.program_topic_id));
  const topicCounts = new Map<string, number>();
  const generatorCounts = new Map<string, number>();

  for (const topic of topics.data ?? []) {
    topicCounts.set(topic.program_id, (topicCounts.get(topic.program_id) ?? 0) + 1);
    if (activeGeneratorIds.has(topic.id)) {
      generatorCounts.set(topic.program_id, (generatorCounts.get(topic.program_id) ?? 0) + 1);
    }
  }

  return (programs.data ?? []).map((program) => ({
    id: program.id,
    name: program.name,
    topicCount: topicCounts.get(program.id) ?? 0,
    generatorCount: generatorCounts.get(program.id) ?? 0,
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
  if (!topicIds.length) return { ...program.data, sections: [], topicCount: 0, generatorCount: 0 };

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
      .filter((topic) => topic.section_id === section.id)
      .map((topic) => ({ id: topic.id, title: topic.title, hasGenerator: activeIds.has(topic.id) })),
  })).filter((section) => section.skills.length > 0);

  return {
    ...program.data,
    sections: grouped,
    topicCount: (topics.data ?? []).length,
    generatorCount: (topics.data ?? []).filter((topic) => activeIds.has(topic.id)).length,
  };
}
