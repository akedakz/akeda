import type { HomeworkRecord, LessonStatus, LessonStatusOverride } from "@/components/students/student-lesson-types";

export type OverviewLesson = {
  id: string;
  studentId: string;
  studentName: string;
  startsAt: string;
  endsAt: string;
  statusOverride: LessonStatusOverride | null;
  status: LessonStatus;
  homework: HomeworkRecord | null;
  topic: { id: string; title: string } | null;
  topicState: "CURRENT" | "EMPTY" | "COMPLETED";
};

export type RecentTestResult = {
  assignmentId: string;
  studentId: string;
  studentName: string;
  title: string;
  score: number;
  maxScore: number;
  percent: number;
  submittedAt: string;
  attemptNumber: number;
};

export type OverviewData = {
  dateLabel: string;
  counters: { total: number; held: number; remaining: number; manualReview: number };
  scheduled: OverviewLesson[];
  completed: OverviewLesson[];
  recentResults: RecentTestResult[];
};
