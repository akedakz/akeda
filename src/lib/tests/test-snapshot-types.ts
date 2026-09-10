import type { NumericMode, PartType, QuestionType } from "@/app/admin/tests/[id]/types";

export type TestSnapshotOption = { key: string; text: string; isCorrect: boolean; position: number };
export type TestSnapshotNumeric = { mode: NumericMode | null; exactValue: number | null; tolerance: number | null; rangeMin: number | null; rangeMax: number | null };
export type TestSnapshotMatching = { allowOptionReuse: boolean; leftItems: Array<{ key: string; label: string; text: string; position: number; correctOptionKey: string }>; options: Array<{ key: string; label: string; text: string; position: number }> };
export type TestSnapshotPart = { key: string; label: string; prompt: string; type: PartType; points: number; position: number; numeric: TestSnapshotNumeric; options: TestSnapshotOption[] };

type SnapshotQuestionBase = { key: string; logicalQuestionId?: string; prompt: string; imagePath: string | null; points: number; required: boolean; position: number };
export type LegacySnapshotQuestion = SnapshotQuestionBase & { type: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "NUMERIC"; numeric: TestSnapshotNumeric; options: TestSnapshotOption[] };
export type MatchingSnapshotQuestion = SnapshotQuestionBase & { type: "MATCHING"; matching: TestSnapshotMatching };
export type MultiPartSnapshotQuestion = SnapshotQuestionBase & { type: "MULTI_PART"; multiPart: { parts: TestSnapshotPart[] } };
export type TestSnapshotQuestion = LegacySnapshotQuestion | MatchingSnapshotQuestion | MultiPartSnapshotQuestion;

type SnapshotBase = { sourceTestId: string; createdBy: string; title: string; description: string };
export type TestSnapshotV1 = SnapshotBase & { version: 1; questions: LegacySnapshotQuestion[] };
export type TestSnapshotV2 = SnapshotBase & { version: 2; questions: TestSnapshotQuestion[] };
export type TestSnapshot = TestSnapshotV1 | TestSnapshotV2;

export type TestAssignmentRow = { id: string; student_id: string; source_test_id: string | null; title: string; snapshot: TestSnapshot; deadline_at: string | null; max_attempts: number; show_correct_answers_after_close: boolean; created_at: string };
export type { QuestionType };
