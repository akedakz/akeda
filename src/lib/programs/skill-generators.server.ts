"server-only";

import { randomInt } from "node:crypto";

type GcdLevel = {
  key: "BASIC" | "CORE" | "CHALLENGE";
  count: number;
  gcd_min: number;
  gcd_max: number;
  multiplier_min: number;
  multiplier_max: number;
  value_max: number;
};

export type GcdGeneratorConfig = {
  questions_per_attempt: number;
  levels: GcdLevel[];
  require_coprime_multipliers?: boolean;
  distinct_values?: boolean;
};

export type GeneratedSkillTask = {
  prompt: string;
  expectedAnswer: string;
  difficulty: GcdLevel["key"];
  parameters: Record<string, number>;
};

function gcd(a: number, b: number) {
  let x = Math.abs(a), y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x;
}

function integer(value: unknown, fallback: number) {
  return Number.isInteger(value) ? Number(value) : fallback;
}

export function parseGcdGeneratorConfig(value: unknown): GcdGeneratorConfig {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<GcdGeneratorConfig>;
  const rawLevels = Array.isArray(raw.levels) ? raw.levels : [];
  const levels = rawLevels.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Partial<GcdLevel>;
    if (!["BASIC", "CORE", "CHALLENGE"].includes(String(row.key))) return [];
    const level: GcdLevel = {
      key: row.key as GcdLevel["key"],
      count: integer(row.count, 0),
      gcd_min: integer(row.gcd_min, 2),
      gcd_max: integer(row.gcd_max, 10),
      multiplier_min: integer(row.multiplier_min, 2),
      multiplier_max: integer(row.multiplier_max, 10),
      value_max: integer(row.value_max, 120),
    };
    if (
      level.count < 1 || level.count > 20
      || level.gcd_min < 1 || level.gcd_max < level.gcd_min
      || level.multiplier_min < 2 || level.multiplier_max < level.multiplier_min
      || level.value_max < 4 || level.value_max > 10000
    ) return [];
    return [level];
  });
  const questions = integer(raw.questions_per_attempt, levels.reduce((sum, level) => sum + level.count, 0));
  if (!levels.length || questions !== levels.reduce((sum, level) => sum + level.count, 0) || questions < 1 || questions > 50) {
    throw new Error("Некорректная конфигурация генератора НОД.");
  }
  return {
    questions_per_attempt: questions,
    levels,
    require_coprime_multipliers: raw.require_coprime_multipliers !== false,
    distinct_values: raw.distinct_values !== false,
  };
}

function generateOne(level: GcdLevel, used: Set<string>, config: GcdGeneratorConfig): GeneratedSkillTask {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const divisor = randomInt(level.gcd_min, level.gcd_max + 1);
    const leftMultiplier = randomInt(level.multiplier_min, level.multiplier_max + 1);
    const rightMultiplier = randomInt(level.multiplier_min, level.multiplier_max + 1);

    if (config.distinct_values && leftMultiplier === rightMultiplier) continue;
    if (config.require_coprime_multipliers && gcd(leftMultiplier, rightMultiplier) !== 1) continue;

    let left = divisor * leftMultiplier;
    let right = divisor * rightMultiplier;
    if (left > level.value_max || right > level.value_max) continue;
    if (config.distinct_values && left === right) continue;

    if (randomInt(0, 2) === 1) [left, right] = [right, left];

    const key = [Math.min(left, right), Math.max(left, right)].join(":");
    if (used.has(key)) continue;
    used.add(key);

    // Because the multipliers are coprime, gcd(divisor*m, divisor*n) is exactly divisor.
    if (gcd(left, right) !== divisor) throw new Error("Generator invariant failed.");

    return {
      prompt: `Найдите НОД(${left}, ${right}).`,
      expectedAnswer: String(divisor),
      difficulty: level.key,
      parameters: { left, right, divisor, leftMultiplier, rightMultiplier },
    };
  }
  throw new Error("Не удалось подобрать уникальные числа по заданным ограничениям.");
}

export function generateGcdTasks(configValue: unknown): GeneratedSkillTask[] {
  const config = parseGcdGeneratorConfig(configValue);
  const used = new Set<string>();
  const tasks: GeneratedSkillTask[] = [];
  for (const level of config.levels) {
    for (let i = 0; i < level.count; i += 1) tasks.push(generateOne(level, used, config));
  }
  return tasks;
}
