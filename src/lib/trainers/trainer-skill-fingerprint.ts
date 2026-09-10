import { createHash } from "node:crypto";
import type { TrainerSkill } from "./trainer-import";

export function fingerprintTrainerSkill(skill: TrainerSkill): string {
  const meaningful = { key: skill.key, name: skill.name, formulaLatex: skill.formulaLatex, variants: skill.variants.map((variant) => ({ key: variant.key, answerVariable: variant.answerVariable, answerUnit: variant.answerUnit, prompts: variant.prompts, variables: variant.variables })) };
  return createHash("sha256").update(JSON.stringify(meaningful), "utf8").digest("hex");
}
