export type ResultsHomework = {
  lessonId: string;
  lessonDate: string;
  dateLabel: string;
  title: string;
  grade: number | null;
  comment: string | null;
};

export type ResultsTest = {
  assignmentId: string;
  attemptId: string;
  title: string;
  bestPercent: number;
  score: number;
  maxScore: number;
  completedAttempts: number;
  completedAt: string;
  completedAtLabel: string;
};

export type ResultsChartPoint = {
  id: string;
  label: string;
  value: number;
};

export type StudentResultsData = {
  overall: { percent: number; hasData: boolean };
  topics: { completed: number; total: number; percent: number; available: boolean };
  homework: {
    completed: number;
    graded: number;
    average: number | null;
    currentStreak: number;
    bestStreak: number;
    history: ResultsHomework[];
  };
  attendance: { attended: number; considered: number; percent: number | null };
  lessonsHeld: number;
  tests: {
    completed: number;
    averagePercent: number | null;
    bestPercent: number | null;
    averageScore: number | null;
    averageMaxScore: number | null;
    history: ResultsTest[];
  };
  charts: {
    homework: ResultsChartPoint[];
    tests: ResultsChartPoint[];
  };
};
