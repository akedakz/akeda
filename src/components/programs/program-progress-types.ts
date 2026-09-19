export type ProgramTopicProgressItem = {
  id: string;
  sectionId: string;
  title: string;
  sortOrder: number;
  completedAt: string | null;
};

export type ProgramSectionProgress = {
  id: string;
  title: string;
  sortOrder: number;
  topics: ProgramTopicProgressItem[];
};

export type LearningProgramProgress = {
  id: string;
  name: string;
  totalTopics: number;
  completedTopics: number;
  percent: number;
  topics: ProgramTopicProgressItem[];
  sections: ProgramSectionProgress[];
};
