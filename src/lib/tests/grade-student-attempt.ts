import type { LegacySnapshotQuestion, TestSnapshot, TestSnapshotPart, TestSnapshotQuestion } from "./test-snapshot-types";
import type { BaseStudentAnswer, StudentAnswer } from "./student-test-types";

function validBaseAnswer(value: unknown, type: LegacySnapshotQuestion["type"], options: Array<{ key: string }>): value is BaseStudentAnswer {
  if (!value || typeof value !== "object") return false;
  const answer = value as Partial<BaseStudentAnswer>;
  if (type === "SINGLE_CHOICE") return answer.type === type && (answer.optionKey === null || typeof answer.optionKey === "string" && options.some((option) => option.key === answer.optionKey));
  if (type === "MULTIPLE_CHOICE") return answer.type === type && Array.isArray(answer.optionKeys) && new Set(answer.optionKeys).size === answer.optionKeys.length && answer.optionKeys.every((key) => typeof key === "string" && options.some((option) => option.key === key));
  return answer.type === "NUMERIC" && (answer.value === null || typeof answer.value === "number" && Number.isFinite(answer.value));
}

export function isStudentAnswer(value: unknown, question: TestSnapshotQuestion): value is StudentAnswer {
  if (!value || typeof value !== "object") return false;
  if (question.type === "SINGLE_CHOICE" || question.type === "MULTIPLE_CHOICE" || question.type === "NUMERIC") return validBaseAnswer(value, question.type, question.options);
  if (question.type === "MATCHING") {
    const answer = value as { type?: unknown; matches?: unknown };
    if (answer.type !== "MATCHING" || !answer.matches || typeof answer.matches !== "object" || Array.isArray(answer.matches)) return false;
    const entries = Object.entries(answer.matches as Record<string, unknown>);
    if (!entries.every(([leftKey, optionKey]) => question.matching.leftItems.some((item) => item.key === leftKey) && typeof optionKey === "string" && question.matching.options.some((option) => option.key === optionKey))) return false;
    return question.matching.allowOptionReuse || new Set(entries.map(([, optionKey]) => optionKey)).size === entries.length;
  }
  if (question.type !== "MULTI_PART") return false;
  const answer = value as { type?: unknown; parts?: unknown };
  if (answer.type !== "MULTI_PART" || !answer.parts || typeof answer.parts !== "object" || Array.isArray(answer.parts)) return false;
  return Object.entries(answer.parts as Record<string, unknown>).every(([key, partAnswer]) => {
    const part = question.multiPart.parts.find((candidate) => candidate.key === key);
    return Boolean(part && validBaseAnswer(partAnswer, part.type, part.options));
  });
}

export function answerIsFilled(answer: StudentAnswer | undefined): boolean {
  if (!answer) return false;
  if (answer.type === "SINGLE_CHOICE") return Boolean(answer.optionKey);
  if (answer.type === "MULTIPLE_CHOICE") return answer.optionKeys.length > 0;
  if (answer.type === "NUMERIC") return answer.value !== null;
  if (answer.type === "MATCHING") return Object.keys(answer.matches).length > 0;
  return Object.values(answer.parts).some((part) => answerIsFilled(part));
}

function baseMatches(question: LegacySnapshotQuestion | TestSnapshotPart, answer: BaseStudentAnswer | undefined) {
  if (!answer || !answerIsFilled(answer) || question.type !== answer.type) return false;
  if (question.type === "SINGLE_CHOICE" && answer.type === "SINGLE_CHOICE") return question.options.some((option) => option.key === answer.optionKey && option.isCorrect);
  if (question.type === "MULTIPLE_CHOICE" && answer.type === "MULTIPLE_CHOICE") {
    const expected = question.options.filter((option) => option.isCorrect).map((option) => option.key);
    return answer.optionKeys.length === expected.length && expected.every((key) => answer.optionKeys.includes(key));
  }
  if (question.type === "NUMERIC" && answer.type === "NUMERIC" && answer.value !== null) {
    if (question.numeric.mode === "EXACT") return answer.value === question.numeric.exactValue;
    if (question.numeric.mode === "TOLERANCE" && question.numeric.exactValue !== null && question.numeric.tolerance !== null) return Math.abs(answer.value - question.numeric.exactValue) <= question.numeric.tolerance;
    if (question.numeric.mode === "RANGE" && question.numeric.rangeMin !== null && question.numeric.rangeMax !== null) return answer.value >= question.numeric.rangeMin && answer.value <= question.numeric.rangeMax;
  }
  return false;
}

export function gradeStudentAttempt(snapshot: TestSnapshot, answers: Map<string, StudentAnswer>) {
  let score = 0, correct = 0, incorrect = 0, unanswered = 0;
  const reviews = snapshot.questions.map((question) => {
    const answer = answers.get(question.key);
    if (!answer || !answerIsFilled(answer)) { unanswered += 1; return { questionKey: question.key, isCorrect: false, points: 0 }; }
    let points = 0;
    if ((question.type === "SINGLE_CHOICE" || question.type === "MULTIPLE_CHOICE" || question.type === "NUMERIC") && (answer.type === "SINGLE_CHOICE" || answer.type === "MULTIPLE_CHOICE" || answer.type === "NUMERIC")) points = baseMatches(question, answer) ? question.points : 0;
    else if (question.type === "MATCHING" && answer.type === "MATCHING") points = question.matching.leftItems.reduce((sum, item) => sum + (answer.matches[item.key] === item.correctOptionKey ? 1 : 0), 0);
    else if (question.type === "MULTI_PART" && answer.type === "MULTI_PART") points = question.multiPart.parts.reduce((sum, part) => sum + (baseMatches(part, answer.parts[part.key]) ? part.points : 0), 0);
    const matches = points === question.points;
    score += points;
    if (matches) correct += 1; else incorrect += 1;
    return { questionKey: question.key, isCorrect: matches, points };
  });
  return { score, maxScore: snapshot.questions.reduce((sum, question) => sum + question.points, 0), correct, incorrect, unanswered, reviews };
}
