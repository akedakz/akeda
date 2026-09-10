export const FORMULA_RECALL_MASTERY_TARGET = 3;

export type FormulaRecallStudentSummary = {
  assignedCount: number;
  masteryPoints: number;
  possiblePoints: number;
  progressPercent: number;
  allMastered: boolean;
  topics: FormulaRecallTopicSummary[];
  masteredTopics: FormulaRecallMasteredTopic[];
};

export type FormulaRecallMasteredTopic = {
  id: string;
  title: string;
  formulas: Array<{ id: string; expression: string }>;
};

export type FormulaRecallTopicSummary = {
  id: string;
  title: string;
  assignedCount: number;
  masteryPoints: number;
  possiblePoints: number;
  progressPercent: number;
};

export type FormulaRecallStudentTask = {
  id: string;
  condition: string;
  topicTitle: string;
  state: "AWAITING_ANSWER" | "REVEALED" | "RETRY_AFTER_HINT" | "CORRECT_CLEAN" | "CORRECT_HINTED";
  canonicalExpression?: string;
  creditAwarded: boolean;
};

export type FormulaRecallAssignmentItem = {
  assignmentId: string | null;
  formulaId: string;
  topicId: string;
  expression: string;
  cleanRecallCount: number;
};

export type FormulaRecallAssignmentTopic = { id: string; title: string; formulas: FormulaRecallAssignmentItem[] };
