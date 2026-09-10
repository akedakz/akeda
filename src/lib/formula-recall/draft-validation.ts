import type { FormulaRecallDraft } from "./types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type FormulaRecallDraftValidationError = {
  ok: false;
  field: "formula" | "conditions" | "alternatives" | "revision";
  code: string;
  message: string;
};

export type FormulaRecallNormalizedDraft = {
  formulaId: string | null;
  topicId: string;
  canonicalExpression: string;
  expectedRevision: number | null;
  conditions: Array<{ id: string; text: string }>;
  alternatives: Array<{ id: string; expression: string }>;
};

export type FormulaRecallDraftValidationResult =
  | { ok: true; draft: FormulaRecallNormalizedDraft }
  | FormulaRecallDraftValidationError;

export function validateFormulaRecallDraft(draft: FormulaRecallDraft): FormulaRecallDraftValidationResult {
  if (!draft || typeof draft !== "object" || typeof draft.topicId !== "string" || !uuid.test(draft.topicId)
    || (draft.formulaId !== null && (typeof draft.formulaId !== "string" || !uuid.test(draft.formulaId)))) {
    return invalid("formula", "invalid_identity", "Некорректные данные формулы.");
  }
  if (typeof draft.canonicalExpression !== "string" || !Array.isArray(draft.conditions) || !Array.isArray(draft.alternatives)) {
    return invalid("formula", "invalid_shape", "Некорректные данные формулы.");
  }
  const canonicalExpression = draft.canonicalExpression.trim();
  if (!canonicalExpression) return invalid("formula", "formula_required", "Введите формулу.");
  if (canonicalExpression.length > 4000) return invalid("formula", "formula_too_long", "Формула слишком длинная.");

  const conditions = draft.conditions
    .filter((item): item is { id: string; text: string } => Boolean(item) && typeof item.id === "string" && typeof item.text === "string")
    .map((item) => ({ id: item.id, text: item.text.trim() }))
    .filter((item) => item.text);
  if (conditions.length < 1 || conditions.length > 30 || conditions.some((item) => !uuid.test(item.id) || item.text.length > 500)
    || draft.conditions.some((item) => !item || typeof item.id !== "string" || typeof item.text !== "string")) {
    return invalid("conditions", "invalid_conditions", "Добавьте хотя бы одно условие длиной до 500 символов.");
  }

  const alternatives = draft.alternatives
    .filter((item): item is { id: string; expression: string } => Boolean(item) && typeof item.id === "string" && typeof item.expression === "string")
    .map((item) => ({ id: item.id, expression: item.expression.trim() }))
    .filter((item) => item.expression);
  if (alternatives.length > 20 || alternatives.some((item) => !uuid.test(item.id) || item.expression.length > 4000)
    || draft.alternatives.some((item) => !item || typeof item.id !== "string" || typeof item.expression !== "string")) {
    return invalid("alternatives", "invalid_alternatives", "Проверьте альтернативные записи.");
  }
  const expressions = alternatives.map((item) => item.expression);
  if (new Set(expressions).size !== expressions.length || expressions.includes(canonicalExpression)) {
    return invalid("alternatives", "duplicate_expression", "Одинаковые записи формулы не нужно добавлять повторно.");
  }
  if (draft.formulaId && (!Number.isInteger(draft.expectedRevision) || (draft.expectedRevision ?? 0) < 1)) {
    return invalid("revision", "invalid_revision", "Некорректная версия формулы.");
  }
  if (!draft.formulaId && draft.expectedRevision !== null) {
    return invalid("revision", "unexpected_revision", "Некорректная версия формулы.");
  }
  return { ok: true, draft: { ...draft, canonicalExpression, conditions, alternatives } };
}

function invalid(field: FormulaRecallDraftValidationError["field"], code: string, message: string): FormulaRecallDraftValidationError {
  return { ok: false, field, code, message };
}
