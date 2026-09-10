export type ProgressTopic = { id: string; title: string; number: number; status: "COMPLETED" | "CURRENT" | "WAITING" };
export type ProgressHomework = { id: string; title: string; dateLabel: string; grade: number | null; comment: string | null; sortAt: string };
export type ProgressTest = { assignmentId: string; attemptId: string | null; title: string; dateLabel: string | null; percent: number | null; status: "COMPLETED" | "MISSED" | "ACTIVE"; sortAt: string };
export type ProgressTrainer = { id: string; type: string; typeLabel: string; typeSortOrder: number; title: string; assignedAt: string | null; fallbackAt: string; status: "COMPLETED" | "ACTIVE"; progressPercent: number };
export type ProgressTrainerType = { type: string; typeLabel: string; typeSortOrder: number; progressPercent: number; completed: number; incomplete: number };

export type StudentProgressData = {
  topics: { total: number; completed: number; percent: number; currentTitle: string | null; allCompleted: boolean; items: ProgressTopic[] };
  lessons: { total: number; attended: number; missed: number; attendancePercent: number | null };
  homework: { average: number | null; monthAverage: number | null; monthLabel: string; graded: number; items: ProgressHomework[] };
  tests: { averagePercent: number | null; completed: number; missed: number; items: ProgressTest[] };
  trainers: { progressPercent: number; completed: number; incomplete: number; types: ProgressTrainerType[]; items: ProgressTrainer[] };
  formulaRecall: { progressPercent: number; mastered: number; assigned: number };
  mistakes: { active: number; corrected: number };
  statistics: { testResponses: number; trainerCompletions: number; formulasMastered: number; mistakesCorrected: number };
};
