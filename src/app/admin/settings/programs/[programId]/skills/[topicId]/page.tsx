import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseGcdGeneratorConfig } from "@/lib/programs/skill-generators.server";
import SkillGeneratorPreview from "./skill-generator-preview";

export default async function SkillPreviewPage({ params }: { params: Promise<{ programId: string; topicId: string }> }) {
  const { programId, topicId } = await params;
  const admin = createAdminClient();
  const [program, topic, generator] = await Promise.all([
    admin.from("learning_programs").select("id,name").eq("id", programId).eq("is_active", true).maybeSingle(),
    admin.from("learning_program_topics").select("id,title,program_id").eq("id", topicId).eq("program_id", programId).maybeSingle(),
    admin.from("learning_program_skill_generators").select("generator_key,config").eq("program_topic_id", topicId).eq("is_active", true).maybeSingle(),
  ]);
  if (program.error || topic.error || generator.error || !program.data || !topic.data || !generator.data) notFound();

  const rules = generator.data.generator_key === "gcd_pair_v1"
    ? parseGcdGeneratorConfig(generator.data.config).levels.map((level) => ({
        key: level.key === "BASIC" ? "Базовый" : level.key === "CORE" ? "Основной" : "Повышенный",
        count: level.count,
        gcdMin: level.gcd_min,
        gcdMax: level.gcd_max,
        multiplierMin: level.multiplier_min,
        multiplierMax: level.multiplier_max,
        valueMax: level.value_max,
      }))
    : [];

  return <SkillGeneratorPreview
    programId={programId}
    topicId={topicId}
    programName={program.data.name}
    topicTitle={topic.data.title}
    backHref={`/admin/settings/programs/${programId}`}
    rules={rules}
  />;
}
