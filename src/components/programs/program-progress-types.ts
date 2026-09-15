export type ProgramTopicProgressItem = {
  id: string;
  title: string;
  sortOrder: number;
  completedAt: string | null;
};

export type LearningProgramProgress = {
  id: string;
  name: string;
  totalTopics: number;
  completedTopics: number;
  percent: number;
  topics: ProgramTopicProgressItem[];
};
