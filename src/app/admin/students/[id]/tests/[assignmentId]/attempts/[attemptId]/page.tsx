import BackLink from "@/components/back-link";
import { notFound, redirect } from "next/navigation";
import TestAttemptReview from "@/components/tests/test-attempt-review";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import {
  gradeStudentAttempt,
  isStudentAnswer,
} from "@/lib/tests/grade-student-attempt";
import type { TestSnapshot } from "@/lib/tests/test-snapshot-types";
import type { StudentAnswer } from "@/lib/tests/student-test-types";
import { signStoragePathsBatch } from "@/lib/storage/sign-storage-paths-batch";
import { createAdminClient } from "@/lib/supabase/admin";
import styles from "./attempt.module.css";

type PageProps = {
  params: Promise<{
    id: string;
    assignmentId: string;
    attemptId: string;
  }>;
};

function isSnapshot(value: unknown): value is TestSnapshot {
  const item = value as Partial<TestSnapshot> | null;
  return Boolean((item?.version === 1 || item?.version === 2) && Array.isArray(item.questions));
}

export default async function AdminStudentAttemptPage({ params }: PageProps) {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (current.profile?.role !== "ADMIN") redirect("/student");

  const { id, assignmentId, attemptId } = await params;
  const admin = createAdminClient();
  const [student, assignment, attempt, answersResult] = await Promise.all([
    admin
      .from("profiles")
      .select("id,full_name,email,role")
      .eq("id", id)
      .eq("role", "STUDENT")
      .maybeSingle(),
    admin
      .from("test_assignments")
      .select("id,student_id,title,snapshot,deadline_at,created_at")
      .eq("id", assignmentId)
      .eq("student_id", id)
      .maybeSingle(),
    admin
      .from("test_attempts")
      .select(
        "id,assignment_id,student_id,attempt_number,started_at,submitted_at,score,max_score,correct_count,incorrect_count,unanswered_count",
      )
      .eq("id", attemptId)
      .eq("assignment_id", assignmentId)
      .eq("student_id", id)
      .maybeSingle(),
    admin
      .from("test_attempt_answers")
      .select("question_key,answer,is_correct,points_awarded")
      .eq("attempt_id", attemptId),
  ]);

  if (
    student.error ||
    assignment.error ||
    attempt.error ||
    answersResult.error ||
    !student.data ||
    !assignment.data ||
    !attempt.data ||
    !attempt.data.submitted_at ||
    !isSnapshot(assignment.data.snapshot)
  ) {
    notFound();
  }

  const snapshot = assignment.data.snapshot;
  const answers = new Map<string, StudentAnswer>();
  const rawAnswers = new Map<string, unknown>();
  const gradingByQuestion = new Map<string, { isCorrect: boolean | null; pointsAwarded: number | null }>();
  for (const row of answersResult.data) {
    rawAnswers.set(row.question_key, row.answer);
    gradingByQuestion.set(row.question_key, { isCorrect: row.is_correct, pointsAwarded: row.points_awarded === null ? null : Number(row.points_awarded) });
    const question = snapshot.questions.find(
      (item) => item.key === row.question_key,
    );
    if (question && isStudentAnswer(row.answer, question)) {
      answers.set(row.question_key, row.answer);
    }
  }

  const imageUrls = Object.fromEntries(await signStoragePathsBatch(
    admin,
    "test-images",
    snapshot.questions.map((question) => question.imagePath),
    3600,
  ));

  const graded = gradeStudentAttempt(snapshot, answers);
  const score = Number(attempt.data.score ?? graded.score);
  const maxScore = Number(attempt.data.max_score ?? graded.maxScore);
  const percent = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  const needsReview = answersResult.data.some((row) => row.is_correct === null && hasAnswerValue(row.answer));
  const fullName = student.data.full_name?.trim() || "Без имени";
  const dateTime = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    dateStyle: "long",
    timeStyle: "short",
  });

  return (
    <main className={styles.page}>
      <div className={styles.back}>
        <BackLink href={`/admin/students/${id}?tab=tests`}>К тестам ученика</BackLink>
      </div>

      <section className={styles.summary}>
        <div className={styles.heading}>
          <div>
            <span>Результат теста</span>
            <h1>{assignment.data.title}</h1>
            <p>
              {fullName} · {student.data.email}
            </p>
          </div>
          <div className={styles.score}>
            <span>Результат</span>
            <strong>{percent}%</strong>
            <small>
              {score} из {maxScore} баллов
            </small>
          </div>
        </div>

        <dl className={styles.meta}>
          <div>
            <dt>Статус</dt>
            <dd className={needsReview ? styles.reviewStatus : styles.completeStatus}>{needsReview ? "Требует проверки" : "Завершён"}</dd>
          </div>
          <div>
            <dt>Назначен</dt>
            <dd>{dateTime.format(new Date(assignment.data.created_at))}</dd>
          </div>
          <div>
            <dt>Дедлайн</dt>
            <dd>{assignment.data.deadline_at ? dateTime.format(new Date(assignment.data.deadline_at)) : "Без дедлайна"}</dd>
          </div>
          <div>
            <dt>Начата</dt>
            <dd>{dateTime.format(new Date(attempt.data.started_at))}</dd>
          </div>
          <div>
            <dt>Завершена</dt>
            <dd>{dateTime.format(new Date(attempt.data.submitted_at))}</dd>
          </div>
          <div>
            <dt>Правильно</dt>
            <dd>{attempt.data.correct_count ?? graded.correct}</dd>
          </div>
          <div>
            <dt>Неправильно</dt>
            <dd>{attempt.data.incorrect_count ?? graded.incorrect}</dd>
          </div>
          <div>
            <dt>Пропущено</dt>
            <dd>{attempt.data.unanswered_count ?? graded.unanswered}</dd>
          </div>
        </dl>
      </section>

      <TestAttemptReview
        snapshot={snapshot}
        answers={answers}
        imageUrls={imageUrls}
        showCorrect
        admin
        rawAnswers={rawAnswers}
        gradingByQuestion={gradingByQuestion}
      />
    </main>
  );
}

function hasAnswerValue(value: unknown) {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value !== "object") return true;
  const answer = value as Record<string, unknown>;
  if ("value" in answer) return answer.value !== null && answer.value !== undefined && answer.value !== "";
  if ("text" in answer) return typeof answer.text === "string" && answer.text.trim().length > 0;
  if ("optionKey" in answer) return Boolean(answer.optionKey);
  if ("optionKeys" in answer) return Array.isArray(answer.optionKeys) && answer.optionKeys.length > 0;
  return Object.keys(answer).length > 0;
}
