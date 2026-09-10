import type { PartType, QuestionType } from "@/app/admin/tests/[id]/types";

export type BaseStudentAnswer =
  | { type: "SINGLE_CHOICE"; optionKey: string | null }
  | { type: "MULTIPLE_CHOICE"; optionKeys: string[] }
  | { type: "NUMERIC"; value: number | null };
export type StudentAnswer = BaseStudentAnswer | { type: "MATCHING"; matches: Record<string, string> } | { type: "MULTI_PART"; parts: Record<string, BaseStudentAnswer> };

export type SafeStudentOption = { key: string; text: string; position: number };
type SafeQuestionBase = { key: string; prompt: string; imageUrl: string | null; points: number; required: boolean; position: number };
export type SafeStudentPart = { key: string; label: string; prompt: string; type: PartType; points: number; position: number; options: SafeStudentOption[] };
export type SafeStudentQuestion = SafeQuestionBase & (
  | { type: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "NUMERIC"; options: SafeStudentOption[] }
  | { type: "MATCHING"; matching: { allowOptionReuse: boolean; leftItems: Array<{ key: string; label: string; text: string; position: number }>; options: Array<{ key: string; label: string; text: string; position: number }> } }
  | { type: "MULTI_PART"; multiPart: { parts: SafeStudentPart[] } }
);
export type SafeStudentTest = { assignmentId: string; title: string; description: string; questions: SafeStudentQuestion[] };
export type StudentAttemptSummary = { id: string; number: number; startedAt: string; submittedAt: string | null; score: number | null; maxScore: number | null };
export type StudentAssignmentSummary = { id: string; title: string; description: string; questionCount: number; createdAt: string; deadlineAt: string | null; attempts: StudentAttemptSummary[]; activeAttemptId: string | null; completed: boolean; score: number | null; maxScore: number | null; lastSubmittedAt: string | null; action: "START" | "CONTINUE" | "EXPIRED" | "VIEW"; urgent: boolean; overdue: boolean };
export type { QuestionType };
