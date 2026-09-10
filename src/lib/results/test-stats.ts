import type { ResultsTest } from "@/components/students/student-results-types";
import { formatResultDateLabel } from "@/lib/results/result-date-label";

export type ResultsAssignmentRow = { id: string; title: string };
export type ResultsAttemptRow = { id: string; assignment_id: string; submitted_at: string | null; score: number | null; max_score: number | null };

export function calculateTestStats(assignments: ResultsAssignmentRow[], attempts: ResultsAttemptRow[]) {
  const assignmentMap = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  const grouped = new Map<string, ResultsAttemptRow[]>();
  for (const attempt of attempts) {
    if (!attempt.submitted_at || attempt.score === null || attempt.max_score === null || attempt.max_score <= 0 || !assignmentMap.has(attempt.assignment_id)) continue;
    grouped.set(attempt.assignment_id, [...(grouped.get(attempt.assignment_id) ?? []), attempt]);
  }
  const history: ResultsTest[] = [];
  for (const [assignmentId, completedAttempts] of grouped) {
    const latest = [...completedAttempts].sort((a, b) => Date.parse(b.submitted_at!) - Date.parse(a.submitted_at!) || compareIds(a.id, b.id))[0];
    history.push({
      assignmentId,
      attemptId: latest.id,
      title: assignmentMap.get(assignmentId)!.title,
      bestPercent: latest.score! / latest.max_score! * 100,
      score: latest.score!,
      maxScore: latest.max_score!,
      completedAttempts: completedAttempts.length,
      completedAt: latest.submitted_at!,
      completedAtLabel: formatResultDateLabel(latest.submitted_at!),
    });
  }
  history.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt) || compareIds(a.attemptId, b.attemptId));
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  return {
    completed: history.length,
    averagePercent: average(history.map((test) => test.bestPercent)),
    bestPercent: history.length ? Math.max(...history.map((test) => test.bestPercent)) : null,
    averageScore: average(history.map((test) => test.score)),
    averageMaxScore: average(history.map((test) => test.maxScore)),
    history,
  };
}

function compareIds(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
