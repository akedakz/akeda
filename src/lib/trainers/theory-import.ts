import { createHash } from "node:crypto";
import { THEORY_IMPORT_VERSION, THEORY_TYPE, type TheoryPreview, type TheoryQuestion } from "./theory-types";

export const THEORY_LIMITS = { rawBytes: 256 * 1024, title: 120, questions: 200, key: 64, text: 2_000, option: 1_000, explanation: 4_000 } as const;
const safeKey = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const rootKeys = new Set(["version", "title", "questions"]);
const questionKeys = new Set(["key", "text", "options", "correctOption", "explanation", "fingerprint"]);

export function fingerprintTheoryQuestion(question: Pick<TheoryQuestion, "text" | "options" | "correctOption">) {
  return createHash("sha256").update(JSON.stringify({ text: question.text, options: question.options, correctOption: question.correctOption }), "utf8").digest("hex");
}

function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function unknownKeys(value: Record<string, unknown>, allowed: Set<string>, prefix: string, errors: string[]) { for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${prefix}: неизвестное поле «${key}».`); }

export function validateTheoryDefinition(input: unknown): { ok: true; value: TheoryPreview } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!object(input)) return { ok: false, errors: ["Корень импорта должен быть JSON-объектом."] };
  unknownKeys(input, rootKeys, "Импорт", errors);
  if (input.version !== THEORY_IMPORT_VERSION) errors.push(`version должен быть «${THEORY_IMPORT_VERSION}».`);
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > THEORY_LIMITS.title) errors.push(`title должен содержать от 1 до ${THEORY_LIMITS.title} символов.`);
  if (!Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > THEORY_LIMITS.questions) errors.push(`questions должен содержать от 1 до ${THEORY_LIMITS.questions} вопросов.`);
  const keys = new Set<string>();
  const questions: TheoryQuestion[] = [];
  if (Array.isArray(input.questions)) input.questions.slice(0, THEORY_LIMITS.questions + 1).forEach((raw, index) => {
    const prefix = `Вопрос ${index + 1}`;
    if (!object(raw)) { errors.push(`${prefix}: ожидается объект.`); return; }
    unknownKeys(raw, questionKeys, prefix, errors);
    const key = typeof raw.key === "string" ? raw.key.trim() : "";
    if (!safeKey.test(key)) errors.push(`${prefix}: key должен соответствовать ${safeKey}.`);
    else if (keys.has(key)) errors.push(`${prefix}: key «${key}» повторяется.`); else keys.add(key);
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    if (!text || text.length > THEORY_LIMITS.text) errors.push(`${prefix}: text должен содержать от 1 до ${THEORY_LIMITS.text} символов.`);
    const options = Array.isArray(raw.options) ? raw.options.map((item) => typeof item === "string" ? item.trim() : "") : [];
    if (options.length !== 4) errors.push(`${prefix}: требуется ровно 4 варианта ответа.`);
    if (options.some((item) => !item || item.length > THEORY_LIMITS.option)) errors.push(`${prefix}: каждый вариант должен содержать от 1 до ${THEORY_LIMITS.option} символов.`);
    const correctOption = raw.correctOption;
    if (!Number.isInteger(correctOption) || (correctOption as number) < 0 || (correctOption as number) > 3) errors.push(`${prefix}: correctOption должен быть целым индексом 0..3.`);
    const explanation = typeof raw.explanation === "string" ? raw.explanation.trim() : "";
    if (!explanation || explanation.length > THEORY_LIMITS.explanation) errors.push(`${prefix}: explanation должен содержать от 1 до ${THEORY_LIMITS.explanation} символов.`);
    if (safeKey.test(key) && text && text.length <= THEORY_LIMITS.text && options.length === 4 && options.every((item) => item && item.length <= THEORY_LIMITS.option) && Number.isInteger(correctOption) && (correctOption as number) >= 0 && (correctOption as number) <= 3 && explanation && explanation.length <= THEORY_LIMITS.explanation) {
      const canonical = { key, text, options: options as TheoryQuestion["options"], correctOption: correctOption as number, explanation };
      questions.push({ ...canonical, fingerprint: fingerprintTheoryQuestion(canonical) });
    }
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { definition: { version: THEORY_IMPORT_VERSION, type: THEORY_TYPE, title, questions }, questionCount: questions.length } };
}

export function parseTheoryImport(raw: string) {
  if (new TextEncoder().encode(raw).length > THEORY_LIMITS.rawBytes) return { ok: false as const, errors: ["Импорт превышает допустимый размер 256 КБ."] };
  try { return validateTheoryDefinition(JSON.parse(raw)); } catch { return { ok: false as const, errors: ["Не удалось прочитать JSON."] }; }
}
