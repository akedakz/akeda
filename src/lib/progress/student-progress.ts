import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { calculateTestStats } from "@/lib/results/test-stats";
import { formatResultDateLabel } from "@/lib/results/result-date-label";
import { buildStudentTestSummaries } from "@/lib/tests/build-student-test-summaries";
import { answerIsFilled } from "@/lib/tests/grade-student-attempt";
import type { StudentAnswer } from "@/lib/tests/student-test-types";
import { calculateTrainerProgress, loadTrainerCards } from "@/lib/trainers/trainer-progress";
import { calculateTheoryOverall, loadTheorySummaries } from "@/lib/trainers/theory-runtime";
import { loadFormulaRecallSummary } from "@/lib/formula-recall/runtime-data";
import { loadStudentMistakeStats } from "@/lib/mistakes/runtime";
import { TRAINER_TYPE_UI } from "@/lib/trainers/trainer-type-metadata";
import type { StudentProgressData, ProgressHomework, ProgressTest, ProgressTrainer } from "@/components/student/progress/student-progress-types";

type TopicRow = { id: string; title: string; sort_order: number; completed_at: string | null };
type LessonRow = { id: string; starts_at: string; ends_at: string; status_override: string | null };
type HomeworkRow = { id: string; lesson_id: string; title: string; grade: number | null; comment: string | null; created_at: string };
type AssignmentRow = { id: string; title: string; snapshot: unknown; created_at: string; deadline_at: string | null; max_attempts: number };
type AttemptRow = { id: string; assignment_id: string; attempt_number: number; started_at: string; submitted_at: string | null; score: number | null; max_score: number | null; correct_count: number | null; incorrect_count: number | null };
type LegacyAnswerRow = { attempt_id: string; answer: unknown };

const monthParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit" });
const monthName = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", month: "long" });

export async function loadStudentProgressByStudentId(studentId: string, options: { lightweightAssignments?: boolean } = {}): Promise<StudentProgressData> {
  const admin = createAdminClient();
  const now = new Date();
  const attemptsPromise = Promise.resolve(admin.from("test_attempts").select("id,assignment_id,attempt_number,started_at,submitted_at,score,max_score,correct_count,incorrect_count").eq("student_id", studentId));
  const legacyAnswersPromise = (async () => {
    const attemptsResult = await attemptsPromise;
    const attempts = (attemptsResult.data ?? []) as AttemptRow[];
    const ids = attempts.filter((attempt) => attempt.submitted_at !== null && (attempt.correct_count === null || attempt.incorrect_count === null)).map((attempt) => attempt.id);
    if (!ids.length) return { data: [] as LegacyAnswerRow[], error: null };
    const result = await admin.from("test_attempt_answers").select("attempt_id,answer").in("attempt_id", ids);
    return { data: (result.data ?? []) as LegacyAnswerRow[], error: result.error };
  })();
  const [topicsResult, lessonsResult, homeworkResult, assignmentsResult, attemptsResult, trainerResult, theoryResult, formulaRecallResult, mistakeStats, legacyAnswersResult] = await Promise.all([
    admin.from("student_topics").select("id,title,sort_order,completed_at").eq("student_id", studentId).order("sort_order").order("id"),
    admin.from("student_lessons").select("id,starts_at,ends_at,status_override").eq("student_id", studentId).is("deleted_at", null).lte("ends_at", now.toISOString()),
    admin.from("lesson_homework_records").select("id,lesson_id,title,grade,comment,created_at").eq("student_id", studentId),
    admin.from("test_assignments").select(options.lightweightAssignments ? "id,title,created_at,deadline_at,max_attempts" : "id,title,snapshot,created_at,deadline_at,max_attempts").eq("student_id", studentId),
    attemptsPromise,
    loadTrainerCards(studentId),
    loadTheorySummaries(studentId),
    loadFormulaRecallSummary(studentId),
    loadStudentMistakeStats(studentId),
    legacyAnswersPromise,
  ]);
  const results = [topicsResult, lessonsResult, homeworkResult, assignmentsResult, attemptsResult];
  const failed = results.find((result) => result.error);
  if (failed?.error) {
    console.error("STUDENT_PROGRESS_LOAD", { code: failed.error.code, message: failed.error.message, details: failed.error.details, hint: failed.error.hint });
    throw new Error("Не удалось загрузить прогресс.");
  }

  const topics = (topicsResult.data ?? []) as TopicRow[];
  const completedTopics = topics.filter((topic) => topic.completed_at !== null).length;
  const currentIndex = topics.findIndex((topic) => topic.completed_at === null);
  const topicItems = topics.map((topic, index) => ({ id: topic.id, title: topic.title, number: index + 1, status: topic.completed_at ? "COMPLETED" as const : index === currentIndex ? "CURRENT" as const : "WAITING" as const }));

  const lessons = (lessonsResult.data ?? []) as LessonRow[];
  const countedLessons = lessons.filter((lesson) => lesson.status_override !== "CANCELLED_BY_TEACHER" && lesson.status_override !== "CANCELLED_BY_STUDENT");
  const attended = countedLessons.filter((lesson) => lesson.status_override === null).length;
  const missed = countedLessons.filter((lesson) => lesson.status_override === "NO_SHOW" || lesson.status_override === "LATE_CANCELLED").length;
  const attendanceBase = attended + missed;
  const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]));

  const homeworkItems: ProgressHomework[] = ((homeworkResult.data ?? []) as HomeworkRow[]).map((item) => {
    const lesson = lessonById.get(item.lesson_id);
    const sortAt = lesson?.starts_at ?? item.created_at;
    return { id: item.id, title: item.title, dateLabel: formatResultDateLabel(sortAt), grade: item.grade, comment: item.comment, sortAt };
  }).sort((a, b) => Date.parse(b.sortAt) - Date.parse(a.sortAt) || compareIds(a.id, b.id));
  const graded = homeworkItems.filter((item) => item.grade !== null);
  const currentMonthKey = getMonthKey(now);
  const monthGraded = graded.filter((item) => getMonthKey(new Date(item.sortAt)) === currentMonthKey);

  const assignments = (assignmentsResult.data ?? []) as unknown as AssignmentRow[];
  const attempts = (attemptsResult.data ?? []) as AttemptRow[];
  if (legacyAnswersResult.error) {
    console.error("STUDENT_PROGRESS_LEGACY_TEST_RESPONSES", { code: legacyAnswersResult.error.code, message: legacyAnswersResult.error.message });
    throw new Error("Не удалось загрузить статистику ответов.");
  }
  const summaries = buildStudentTestSummaries(assignments, attempts, now);
  const testStats = calculateTestStats(assignments.map(({ id, title }) => ({ id, title })), attempts);
  const bestByAssignment = new Map(testStats.history.map((item) => [item.assignmentId, item]));
  const testItems = summaries.map<ProgressTest>((summary) => {
    const best = bestByAssignment.get(summary.id);
    const missedTest = summary.overdue && !summary.completed && summary.activeAttemptId === null;
    if (best) return { assignmentId: summary.id, attemptId: best.attemptId, title: summary.title, dateLabel: best.completedAtLabel, percent: best.bestPercent, status: "COMPLETED", sortAt: best.completedAt };
    return { assignmentId: summary.id, attemptId: null, title: summary.title, dateLabel: summary.deadlineAt ? `Дедлайн: ${formatResultDateLabel(summary.deadlineAt)}` : null, percent: null, status: missedTest ? "MISSED" : "ACTIVE", sortAt: summary.deadlineAt ?? summary.createdAt };
  }).sort((a, b) => statusRank(a.status) - statusRank(b.status) || Date.parse(b.sortAt) - Date.parse(a.sortAt) || compareIds(a.assignmentId, b.assignmentId));

  const trainerError = trainerResult.error ?? theoryResult.error ?? formulaRecallResult.error ?? mistakeStats.error;
  if (trainerError) {
    console.error("STUDENT_TRAINER_PROGRESS_LOAD", trainerError);
    throw new Error("Не удалось загрузить прогресс тренажёров.");
  }
  const quickProblemItems = trainerResult.cards.map<ProgressTrainer>((card) => {
    const metadata = TRAINER_TYPE_UI[card.type as keyof typeof TRAINER_TYPE_UI];
    return {
      id: card.kind === "ACTIVE" ? card.assignmentId : card.completionId,
      type: card.type,
      typeLabel: metadata?.label ?? card.type,
      typeSortOrder: metadata?.sortOrder ?? Number.MAX_SAFE_INTEGER,
      title: card.title,
      assignedAt: card.assignedAt,
      fallbackAt: card.kind === "ACTIVE" ? card.assignedAt : card.completedAt,
      status: card.kind,
      progressPercent: card.progressPercent,
    };
  });
  const theoryItems = theoryResult.cards.map<ProgressTrainer>((card) => ({
    id: card.kind === "ACTIVE" ? card.assignmentId! : `theory:${card.sourceTrainerId ?? card.title}:${card.completedAt}`,
    type: "THEORY",
    typeLabel: TRAINER_TYPE_UI.THEORY.label,
    typeSortOrder: TRAINER_TYPE_UI.THEORY.sortOrder,
    title: card.title,
    assignedAt: card.assignedAt,
    fallbackAt: card.kind === "ACTIVE" ? card.assignedAt : card.completedAt!,
    status: card.kind,
    progressPercent: card.progressPercent,
  }));
  const trainerItems = [...quickProblemItems, ...theoryItems].sort(compareTrainerItems);
  const quickProblemProgress = calculateTrainerProgress(trainerResult.cards).progressPercent;
  const theoryProgress = calculateTheoryOverall(theoryResult.cards);
  const trainerTypes = [
    buildTrainerType("QUICK_PROBLEMS", quickProblemProgress, quickProblemItems),
    buildTrainerType("THEORY", theoryProgress, theoryItems),
  ].filter((item) => item.completed + item.incomplete > 0);
  const trainerProgress = calculateCombinedTrainerProgress(trainerResult.cards, theoryResult.cards);
  const formulasMastered = formulaRecallResult.summary.masteredTopics.reduce((total, topic) => total + topic.formulas.length, 0);
  const modernTestResponses = attempts.filter((attempt) => attempt.submitted_at !== null && attempt.correct_count !== null && attempt.incorrect_count !== null).reduce((total, attempt) => total + attempt.correct_count! + attempt.incorrect_count!, 0);
  const legacyTestResponses = legacyAnswersResult.data.filter((row) => answerIsFilled(row.answer as StudentAnswer)).length;
  const testResponses = modernTestResponses + legacyTestResponses;
  const trainerCompletions = trainerItems.filter((item) => item.status === "COMPLETED").length;

  return {
    topics: { total: topics.length, completed: completedTopics, percent: topics.length ? Math.round(completedTopics / topics.length * 100) : 0, currentTitle: currentIndex >= 0 ? topics[currentIndex].title : null, allCompleted: topics.length > 0 && completedTopics === topics.length, items: topicItems },
    lessons: { total: countedLessons.length, attended, missed, attendancePercent: attendanceBase ? attended / attendanceBase * 100 : null },
    homework: { average: average(graded.map((item) => item.grade!)), monthAverage: average(monthGraded.map((item) => item.grade!)), monthLabel: capitalize(monthName.format(now)), graded: graded.length, items: homeworkItems },
    tests: { averagePercent: testStats.averagePercent, completed: testStats.completed, missed: testItems.filter((item) => item.status === "MISSED").length, items: testItems },
    trainers: { progressPercent: trainerProgress, completed: trainerItems.filter((item) => item.status === "COMPLETED").length, incomplete: trainerItems.filter((item) => item.status === "ACTIVE").length, types: trainerTypes, items: trainerItems },
    formulaRecall: { progressPercent: formulaRecallResult.summary.progressPercent, mastered: formulasMastered, assigned: formulaRecallResult.summary.assignedCount },
    mistakes: { active: mistakeStats.active, corrected: mistakeStats.corrected },
    statistics: { testResponses, trainerCompletions, formulasMastered, mistakesCorrected: mistakeStats.corrected },
  };
}

function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function getMonthKey(date: Date) { const parts = monthParts.formatToParts(date); return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`; }
function statusRank(status: ProgressTest["status"]) { return status === "COMPLETED" ? 0 : status === "MISSED" ? 1 : 2; }
function compareIds(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }
function compareTrainerItems(a: ProgressTrainer, b: ProgressTrainer) {
  if (a.typeSortOrder !== b.typeSortOrder) return a.typeSortOrder - b.typeSortOrder;
  if (a.type !== b.type) return compareIds(a.type, b.type);
  if (a.assignedAt && b.assignedAt) return Date.parse(a.assignedAt) - Date.parse(b.assignedAt) || compareIds(a.id, b.id);
  if (a.assignedAt !== b.assignedAt) return a.assignedAt ? -1 : 1;
  return Date.parse(a.fallbackAt) - Date.parse(b.fallbackAt) || compareIds(a.id, b.id);
}
function buildTrainerType(type: keyof typeof TRAINER_TYPE_UI, progressPercent: number, items: ProgressTrainer[]) {
  const metadata = TRAINER_TYPE_UI[type];
  return { type, typeLabel: metadata.label, typeSortOrder: metadata.sortOrder, progressPercent, completed: items.filter((item) => item.status === "COMPLETED").length, incomplete: items.filter((item) => item.status === "ACTIVE").length };
}
function calculateCombinedTrainerProgress(quickProblems: Awaited<ReturnType<typeof loadTrainerCards>>["cards"], theory: Awaited<ReturnType<typeof loadTheorySummaries>>["cards"]) {
  const quickRequired = quickProblems.reduce((sum, card) => sum + card.skillsCount * 5, 0);
  const quickEarned = quickProblems.reduce((sum, card) => sum + (card.kind === "COMPLETED" ? card.skillsCount * 5 : Math.min(card.skillsCount * 5, Math.max(0, card.creditedCorrect))), 0);
  const theoryRequired = theory.reduce((sum, card) => sum + card.required, 0);
  const theoryEarned = theory.reduce((sum, card) => sum + card.earned, 0);
  const required = quickRequired + theoryRequired;
  return required ? Math.round((quickEarned + theoryEarned) / required * 100) : 0;
}
function capitalize(value: string) { return value ? value[0].toUpperCase() + value.slice(1) : value; }
