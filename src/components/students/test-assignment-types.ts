export type LibraryFolder = { id: string; name: string; created_at: string };
export type LibraryTest = { id: string; title: string; description: string | null; created_at: string; questionCount: number; maxPoints: number };
export type LibraryLevel = { breadcrumb: { id: string; name: string }[]; folders: LibraryFolder[]; tests: LibraryTest[] };

export type AssignmentListItem = {
  id: string;
  title: string;
  sourceTestId: string | null;
  deadlineAt: string | null;
  createdAt: string;
  status: "COMPLETED" | "REVIEW" | "OVERDUE" | "IN_PROGRESS" | "EXPECTED";
  latestSubmittedAttemptId: string | null;
  submittedAt: string | null;
  score: number | null;
  maxScore: number | null;
  hasAttempts: boolean;
};

export type AssignmentActionState = {
  status: "idle" | "error" | "success";
  message: string;
};

export const initialAssignmentState: AssignmentActionState = {
  status: "idle",
  message: "",
};
