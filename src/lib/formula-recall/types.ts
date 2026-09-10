export type FormulaRecallTopic = { id: string; title: string; sortOrder: number };
export type FormulaRecallCondition = { id: string; text: string; sortOrder: number };
export type FormulaRecallAlternative = { id: string; expression: string; sortOrder: number };
export type FormulaRecallFormula = {
  id: string;
  topicId: string;
  canonicalExpression: string;
  sortOrder: number;
  contentRevision: number;
  updatedAt: string;
  conditions: FormulaRecallCondition[];
  alternatives: FormulaRecallAlternative[];
};

export type FormulaRecallDraft = {
  formulaId: string | null;
  topicId: string;
  canonicalExpression: string;
  expectedRevision: number | null;
  conditions: Array<{ id: string; text: string }>;
  alternatives: Array<{ id: string; expression: string }>;
};

export type FormulaRecallCreateDraft = Pick<FormulaRecallDraft, "canonicalExpression" | "conditions" | "alternatives">;

export type FormulaRecallBatchCreateInput = {
  requestId: string;
  topicId: string;
  formulas: FormulaRecallCreateDraft[];
};
