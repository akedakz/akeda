import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LearningProgramProgress, ProgramTopicProgressItem } from "@/components/programs/program-progress-types";

type AssignmentRow = { program_id: string; created_at: string };
type ProgramRow = { id: string; name: string };
type TopicRow = { id: string; program_id: string; title: string; sort_order: number };
type ProgressRow = { program_id: string; program_topic_id: string; completed_at: string };

export async function loadStudentLearningProgramProgress(
  admin: SupabaseClient,
  studentId: string,
): Promise<{ programs: LearningProgramProgress[]; error: string | null }> {
  const assignments = await admin
    .from("student_learning_programs")
    .select("program_id,created_at")
    .eq("student_id", studentId)
    .order("created_at", { ascending: true });

  if (assignments.error) {
    console.error("PROGRAM_PROGRESS_ASSIGNMENTS", {
      code: assignments.error.code,
      message: assignments.error.message,
    });
    return { programs: [], error: "Не удалось загрузить программы обучения." };
  }

  const links = (assignments.data ?? []) as AssignmentRow[];
  if (!links.length) return { programs: [], error: null };

  const programIds = links.map((item) => item.program_id);
  const [programsResult, topicsResult, progressResult] = await Promise.all([
    admin.from("learning_programs").select("id,name").in("id", programIds),
    admin
      .from("learning_program_topics")
      .select("id,program_id,title,sort_order")
      .in("program_id", programIds)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true }),
    admin
      .from("student_learning_program_topic_progress")
      .select("program_id,program_topic_id,completed_at")
      .eq("student_id", studentId)
      .in("program_id", programIds),
  ]);

  const error = programsResult.error ?? topicsResult.error ?? progressResult.error;
  if (error) {
    console.error("PROGRAM_PROGRESS_LOAD", { code: error.code, message: error.message });
    return { programs: [], error: "Не удалось загрузить прогресс программы." };
  }

  const programMap = new Map(((programsResult.data ?? []) as ProgramRow[]).map((item) => [item.id, item]));
  const progressMap = new Map(
    ((progressResult.data ?? []) as ProgressRow[]).map((item) => [item.program_topic_id, item.completed_at]),
  );
  const topicsByProgram = new Map<string, TopicRow[]>();

  for (const topic of (topicsResult.data ?? []) as TopicRow[]) {
    topicsByProgram.set(topic.program_id, [...(topicsByProgram.get(topic.program_id) ?? []), topic]);
  }

  const programs: LearningProgramProgress[] = [];

  for (const assignment of links) {
    const program = programMap.get(assignment.program_id);
    if (!program) continue;

    const sourceTopics = topicsByProgram.get(program.id) ?? [];
    const topics: ProgramTopicProgressItem[] = sourceTopics.map((topic) => ({
      id: topic.id,
      title: topic.title,
      sortOrder: topic.sort_order,
      completedAt: progressMap.get(topic.id) ?? null,
    }));

    topics.sort((first, second) => {
      const firstCompleted = first.completedAt !== null;
      const secondCompleted = second.completedAt !== null;
      if (firstCompleted !== secondCompleted) return firstCompleted ? -1 : 1;
      if (firstCompleted && secondCompleted) {
        const completedOrder = Date.parse(first.completedAt!) - Date.parse(second.completedAt!);
        if (completedOrder !== 0) return completedOrder;
      }
      return first.sortOrder - second.sortOrder || first.id.localeCompare(second.id);
    });

    const completedTopics = topics.filter((topic) => topic.completedAt).length;
    const totalTopics = topics.length;

    programs.push({
      id: program.id,
      name: program.name,
      totalTopics,
      completedTopics,
      percent: totalTopics ? Math.round((completedTopics / totalTopics) * 100) : 0,
      topics,
    });
  }

  return { programs, error: null };
}
