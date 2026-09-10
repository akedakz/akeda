import type { ResultsHomework } from "@/components/students/student-results-types";

export function calculateHomeworkStats(records: ResultsHomework[]) {
  const chronological = [...records].sort((a, b) => Date.parse(a.lessonDate) - Date.parse(b.lessonDate) || compareIds(a.lessonId, b.lessonId));
  const graded = chronological.filter((record) => record.grade !== null);
  const average = graded.length ? graded.reduce((sum, record) => sum + record.grade!, 0) / graded.length : null;
  let currentStreak = 0;
  let bestStreak = 0;
  for (const record of chronological) {
    if (record.grade === null) continue;
    if (record.grade >= 7) {
      currentStreak += 1;
      bestStreak = Math.max(bestStreak, currentStreak);
    } else currentStreak = 0;
  }
  return { completed: graded.length, graded: graded.length, average, currentStreak, bestStreak };
}

function compareIds(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
