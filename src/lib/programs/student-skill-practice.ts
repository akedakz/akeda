import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type StudentSkillCard = {
  id: string;
  title: string;
  sectionId: string;
  sectionTitle: string;
  programId: string;
  programName: string;
  completedAt: string | null;
};

export type StudentSkillProgram = {
  id: string;
  name: string;
  sections: {
    id: string;
    title: string;
    skills: StudentSkillCard[];
  }[];
};

export async function loadStudentSkillLibrary(studentId: string) {
  const admin = createAdminClient();
  const assignments = await admin.from("student_learning_programs")
    .select("program_id,created_at")
    .eq("student_id", studentId)
    .order("created_at");

  if (assignments.error) throw assignments.error;
  const programIds = (assignments.data ?? []).map((item) => item.program_id);
  if (!programIds.length) return { programs: [] as StudentSkillProgram[], total: 0, completed: 0, percent: 0 };

  const [programs, sections, topics, generators, progress] = await Promise.all([
    admin.from("learning_programs").select("id,name").in("id", programIds).eq("is_active", true),
    admin.from("learning_program_sections").select("id,program_id,title,sort_order").in("program_id", programIds).order("sort_order").order("id"),
    admin.from("learning_program_topics").select("id,program_id,section_id,title,sort_order").in("program_id", programIds).order("sort_order").order("id"),
    admin.from("learning_program_skill_generators").select("program_topic_id").eq("is_active", true),
    admin.from("student_learning_program_topic_progress").select("program_topic_id,completed_at").eq("student_id", studentId).in("program_id", programIds),
  ]);

  const error = programs.error ?? sections.error ?? topics.error ?? generators.error ?? progress.error;
  if (error) throw error;

  const programMap = new Map((programs.data ?? []).map((item) => [item.id, item]));
  const generatorIds = new Set((generators.data ?? []).map((item) => item.program_topic_id));
  const progressMap = new Map((progress.data ?? []).map((item) => [item.program_topic_id, item.completed_at]));
  const sectionRows = sections.data ?? [];
  const topicRows = (topics.data ?? []).filter((topic) => generatorIds.has(topic.id));

  const result: StudentSkillProgram[] = [];
  for (const assignment of assignments.data ?? []) {
    const program = programMap.get(assignment.program_id);
    if (!program) continue;
    const programSections = sectionRows.filter((section) => section.program_id === program.id).map((section) => {
      const skills = topicRows
        .filter((topic) => topic.program_id === program.id && topic.section_id === section.id)
        .map((topic) => ({
          id: topic.id,
          title: topic.title,
          sectionId: section.id,
          sectionTitle: section.title,
          programId: program.id,
          programName: program.name,
          completedAt: progressMap.get(topic.id) ?? null,
        }));
      return { id: section.id, title: section.title, skills };
    }).filter((section) => section.skills.length > 0);
    if (programSections.length) result.push({ id: program.id, name: program.name, sections: programSections });
  }

  const skills = result.flatMap((program) => program.sections.flatMap((section) => section.skills));
  const completed = skills.filter((skill) => skill.completedAt).length;
  return {
    programs: result,
    total: skills.length,
    completed,
    percent: skills.length ? Math.round(completed / skills.length * 100) : 0,
  };
}

export async function loadStudentSkillAccess(studentId: string, topicId: string) {
  const admin = createAdminClient();
  const topic = await admin.from("learning_program_topics")
    .select("id,title,program_id,section_id")
    .eq("id", topicId)
    .maybeSingle();
  if (topic.error || !topic.data) return null;

  const assigned = await admin.from("student_learning_programs")
    .select("program_id")
    .eq("student_id", studentId)
    .eq("program_id", topic.data.program_id)
    .maybeSingle();
  if (assigned.error || !assigned.data) return null;

  const [program, section, generator, progress] = await Promise.all([
    admin.from("learning_programs").select("id,name").eq("id", topic.data.program_id).eq("is_active", true).maybeSingle(),
    admin.from("learning_program_sections").select("id,title").eq("id", topic.data.section_id).eq("program_id", topic.data.program_id).maybeSingle(),
    admin.from("learning_program_skill_generators").select("id,generator_key,config").eq("program_topic_id", topicId).eq("is_active", true).maybeSingle(),
    admin.from("student_learning_program_topic_progress").select("completed_at").eq("student_id", studentId).eq("program_topic_id", topicId).maybeSingle(),
  ]);

  if (program.error || section.error || generator.error || progress.error || !program.data || !section.data || !generator.data) return null;
  return {
    topic: topic.data,
    program: program.data,
    section: section.data,
    generator: generator.data,
    completedAt: progress.data?.completed_at ?? null,
  };
}
