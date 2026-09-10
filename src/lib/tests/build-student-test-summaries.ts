import type { TestSnapshot } from "./test-snapshot-types";
import type { StudentAssignmentSummary, StudentAttemptSummary } from "./student-test-types";

type Assignment = { id: string; title: string; snapshot?: unknown; question_count?: number; description?: string; created_at: string; deadline_at: string | null };
type Attempt = { id: string; assignment_id: string; attempt_number: number; started_at: string; submitted_at: string | null; score: number | null; max_score: number | null };
function snapshot(value: unknown): TestSnapshot | null { const item = value as Partial<TestSnapshot> | null; return (item?.version === 1 || item?.version === 2) && Array.isArray(item.questions) ? item as TestSnapshot : null; }

export function buildStudentTestSummaries(assignments: Assignment[], attempts: Attempt[], now = new Date()): StudentAssignmentSummary[] {
  const grouped = new Map<string, Attempt[]>();
  for (const attempt of attempts) grouped.set(attempt.assignment_id, [...(grouped.get(attempt.assignment_id) ?? []), attempt]);
  return assignments.map((assignment) => {
    const test = snapshot(assignment.snapshot); const rows = grouped.get(assignment.id) ?? [];
    const safeAttempts: StudentAttemptSummary[] = rows.map((attempt) => ({ id: attempt.id, number: attempt.attempt_number, startedAt: attempt.started_at, submittedAt: attempt.submitted_at, score: attempt.score === null ? null : Number(attempt.score), maxScore: attempt.max_score === null ? null : Number(attempt.max_score) }));
    const completed = safeAttempts.filter((attempt) => attempt.submittedAt !== null);
    const latest = completed.sort((a, b) => Date.parse(b.submittedAt!) - Date.parse(a.submittedAt!))[0];
    const active = safeAttempts.find((attempt) => !attempt.submittedAt) ?? null;
    const deadline = assignment.deadline_at ? new Date(assignment.deadline_at) : null; const overdue = Boolean(deadline && deadline <= now); const urgent = Boolean(deadline && !overdue && deadline.getTime() - now.getTime() < 86400000);
    const action: StudentAssignmentSummary["action"] = active ? overdue ? "EXPIRED" : "CONTINUE" : completed.length ? "VIEW" : overdue ? "EXPIRED" : "START";
    return { id: assignment.id, title: assignment.title, description: test?.description ?? assignment.description ?? "", questionCount: test?.questions.length ?? assignment.question_count ?? 0, createdAt: assignment.created_at, deadlineAt: assignment.deadline_at, attempts: safeAttempts.sort((a, b) => b.number - a.number), activeAttemptId: active?.id ?? null, completed: completed.length > 0, score: latest?.score ?? null, maxScore: latest?.maxScore ?? null, lastSubmittedAt: latest?.submittedAt ?? null, action, urgent, overdue };
  });
}

export function sortPendingTests(items: StudentAssignmentSummary[]) { return [...items].sort((a, b) => { if (a.overdue !== b.overdue) return a.overdue ? -1 : 1; if (a.deadlineAt && b.deadlineAt) return Date.parse(a.deadlineAt) - Date.parse(b.deadlineAt); if (a.deadlineAt !== b.deadlineAt) return a.deadlineAt ? -1 : 1; return Date.parse(b.createdAt) - Date.parse(a.createdAt); }); }
