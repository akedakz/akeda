import { randomInt, randomUUID } from "node:crypto";

export type Grade2GeneratorKey =
  | "grade2_multiplication_v1"
  | "grade2_addition_v1"
  | "grade2_subtraction_v1"
  | "grade2_mixed_v1"
  | "grade2_parentheses_v1";

export type Grade2GeneratedQuestion = {
  key: string;
  prompt: string;
  answer: number;
  category: "add" | "subtract" | "multiply" | "parentheses";
};

const rand = (min: number, max: number) => randomInt(min, max + 1);
const pick = <T>(items: T[]) => items[randomInt(items.length)];

function shuffle<T>(values: T[]) {
  for (let i = values.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

function addition(carry: boolean): Omit<Grade2GeneratedQuestion, "key"> {
  let a: number, b: number;
  do { a = rand(1, 9); b = rand(1, 9); }
  while ((a + b >= 10) !== carry);
  return { prompt: `${a} + ${b} = ?`, answer: a + b, category: "add" };
}

function subtraction(teens: boolean): Omit<Grade2GeneratedQuestion, "key"> {
  const a = teens ? rand(10, 20) : rand(2, 9);
  const b = rand(1, Math.min(9, a - 1));
  return { prompt: `${a} − ${b} = ?`, answer: a - b, category: "subtract" };
}

function multiplication(): Omit<Grade2GeneratedQuestion, "key"> {
  const a = rand(2, 9), b = rand(2, 9);
  return { prompt: `${a} × ${b} = ?`, answer: a * b, category: "multiply" };
}

function parentheses(kind: number): Omit<Grade2GeneratedQuestion, "key"> {
  if (kind === 0) {
    const a = rand(2, 9), b = rand(1, 9), c = rand(1, a + b - 1);
    return { prompt: `(${a} + ${b}) − ${c} = ?`, answer: a + b - c, category: "parentheses" };
  }
  if (kind === 1) {
    const a = rand(10, 20), b = rand(1, 9), c = rand(1, a - b - 1);
    return { prompt: `${a} − (${b} + ${c}) = ?`, answer: a - b - c, category: "parentheses" };
  }
  if (kind === 2) {
    const a = rand(2, 9), b = rand(1, 5), c = rand(1, 9 - b);
    return { prompt: `${a} × (${b} + ${c}) = ?`, answer: a * (b + c), category: "parentheses" };
  }
  const a = rand(4, 12), b = rand(1, a - 2), c = rand(2, 9);
  const answer = (a - b) * c;
  if (answer > 100) return parentheses(kind);
  return { prompt: `(${a} − ${b}) × ${c} = ?`, answer, category: "parentheses" };
}

type TaskVariant =
  | "add-carry" | "add-no-carry" | "subtract-small" | "subtract-teens"
  | "multiply" | "parentheses-0" | "parentheses-1" | "parentheses-2" | "parentheses-3";

function render(variant: TaskVariant) {
  if (variant === "add-carry") return addition(true);
  if (variant === "add-no-carry") return addition(false);
  if (variant === "subtract-small") return subtraction(false);
  if (variant === "subtract-teens") return subtraction(true);
  if (variant === "multiply") return multiplication();
  return parentheses(Number(variant.slice(-1)));
}

function plan(key: Grade2GeneratorKey): TaskVariant[] {
  if (key === "grade2_multiplication_v1") return Array(16).fill("multiply");
  if (key === "grade2_addition_v1") return [...Array(8).fill("add-carry"), ...Array(8).fill("add-no-carry")];
  if (key === "grade2_subtraction_v1") return [...Array(8).fill("subtract-small"), ...Array(8).fill("subtract-teens")];
  if (key === "grade2_mixed_v1") return [
    ...Array(3).fill("add-carry"),...Array(3).fill("add-no-carry"),
    ...Array(3).fill("subtract-small"),...Array(2).fill("subtract-teens"),...Array(5).fill("multiply"),
  ];
  if (key === "grade2_parentheses_v1") return [
    ...Array(4).fill("parentheses-0"),...Array(4).fill("parentheses-1"),
    ...Array(4).fill("parentheses-2"),...Array(4).fill("parentheses-3"),
  ];
  throw new Error("Unknown grade 2 generator");
}

export const GRADE2_KEYS: Grade2GeneratorKey[] = [
  "grade2_multiplication_v1", "grade2_addition_v1", "grade2_subtraction_v1",
  "grade2_mixed_v1", "grade2_parentheses_v1",
];

export function isGrade2Key(value: string): value is Grade2GeneratorKey {
  return GRADE2_KEYS.includes(value as Grade2GeneratorKey);
}

export function generateGrade2Questions(key: Grade2GeneratorKey): Grade2GeneratedQuestion[] {
  const result: Grade2GeneratedQuestion[] = [];
  const seen = new Set<string>();
  for (const variant of shuffle(plan(key)) as TaskVariant[]) {
    let question: ReturnType<typeof render> | undefined;
    for (let tries = 0; tries < 300; tries++) {
      const next = render(variant);
      if (!seen.has(next.prompt)) { question = next; break; }
    }
    if (!question) throw new Error(`Could not generate 16 distinct questions for ${key}`);
    if (!Number.isSafeInteger(question.answer) || question.answer < 0 || question.answer > 100) throw new Error("Invalid elementary arithmetic question");
    seen.add(question.prompt);
    result.push({ ...question, key: randomUUID() });
  }
  if (result.length !== 16) throw new Error("Question count mismatch");
  return result;
}
