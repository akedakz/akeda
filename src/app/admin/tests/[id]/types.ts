export type QuestionType = "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "NUMERIC" | "MATCHING" | "MULTI_PART";
export type NumericMode = "EXACT" | "TOLERANCE" | "RANGE";
export type PartType = "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "NUMERIC";

export type EditorOption = {
  id: string | null;
  clientId: string;
  text: string;
  isCorrect: boolean;
  position: number;
};

export type MatchingLeftItem = { key: string; label: string; text: string; position: number; correctOptionKey: string | null };
export type MatchingOption = { key: string; label: string; text: string; position: number };
export type MatchingConfig = { allowOptionReuse: boolean; leftItems: MatchingLeftItem[]; options: MatchingOption[] };
export type MultiPartPart = { key: string; label: string; prompt: string; type: PartType; points: number; position: number; numericMode: NumericMode | null; numericAnswer: number | null; numericTolerance: number | null; numericMin: number | null; numericMax: number | null; options: EditorOption[] };
export type MultiPartConfig = { parts: MultiPartPart[] };
export type QuestionTypeConfig = { matching: MatchingConfig } | { multiPart: MultiPartConfig };

export type EditorQuestion = {
  id: string | null;
  clientId: string;
  type: QuestionType;
  prompt: string;
  imagePath: string | null;
  imageUrl: string | null;
  points: number;
  isRequired: boolean;
  position: number;
  numericMode: NumericMode | null;
  numericAnswer: number | null;
  numericTolerance: number | null;
  numericMin: number | null;
  numericMax: number | null;
  options: EditorOption[];
  typeConfig: QuestionTypeConfig | null;
};

export type EditorTest = {
  id: string;
  folderId: string | null;
  title: string;
  description: string;
  questions: EditorQuestion[];
  status: "DRAFT" | "PUBLISHED";
};

export type EditorValidationErrors = { title?: string; questions: Record<string, string[]> };
