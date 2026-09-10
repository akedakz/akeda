export const THEORY_IMPORT_VERSION = "NSP_THEORY_IMPORT_V1" as const;
export const THEORY_TYPE = "THEORY" as const;

export type TheoryStatus = "DRAFT" | "PUBLISHED";
export type TheoryQuestion = {
  key: string;
  text: string;
  options: [string, string, string, string];
  correctOption: number;
  explanation: string;
  fingerprint: string;
};
export type TheoryDefinition = {
  version: typeof THEORY_IMPORT_VERSION;
  type: typeof THEORY_TYPE;
  title: string;
  questions: TheoryQuestion[];
};
export type TheoryPreview = { definition: TheoryDefinition; questionCount: number };
export type TheoryTrainer = {
  id: string;
  title: string;
  status: TheoryStatus;
  definition: TheoryDefinition;
  contentRevision: number;
  updatedAt: string;
};
