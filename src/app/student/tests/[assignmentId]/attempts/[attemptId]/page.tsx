import BackLink from "@/components/back-link";
import { redirect } from "next/navigation";
import DeletedTestState from "@/components/student/tests/deleted-test-state";
import TestRunner from "@/components/student/tests/test-runner";
import TestAttemptReview from "@/components/tests/test-attempt-review";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import {
  gradeStudentAttempt,
  isStudentAnswer,
} from "@/lib/tests/grade-student-attempt";
import type { TestSnapshot } from "@/lib/tests/test-snapshot-types";
import type {
  SafeStudentTest,
  StudentAnswer,
} from "@/lib/tests/student-test-types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import styles from "./attempt.module.css";

function isSnapshot(value: unknown): value is TestSnapshot {
  const item = value as Partial<TestSnapshot> | null;
  return Boolean((item?.version === 1 || item?.version === 2) && Array.isArray(item.questions));
}

export default async function StudentAttemptPage({
  params,
}: {
  params: Promise<{ assignmentId: string; attemptId: string }>;
}) {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (current.profile?.role !== "STUDENT") redirect("/admin");

  const { assignmentId, attemptId } = await params;
  const supabase = await createClient();
  const admin = createAdminClient();
  const [assignment, attempt, answersResult, submittedAttemptsResult] = await Promise.all([
    admin
      .from("test_assignments")
      .select(
        "id,title,snapshot,deadline_at,max_attempts,show_correct_answers_after_close",
      )
      .eq("id", assignmentId)
      .eq("student_id", current.user.id)
      .maybeSingle(),
    supabase
      .from("test_attempts")
      .select(
        "id,assignment_id,attempt_number,started_at,submitted_at,score,max_score,correct_count,incorrect_count,unanswered_count",
      )
      .eq("id", attemptId)
      .eq("assignment_id", assignmentId)
      .eq("student_id", current.user.id)
      .maybeSingle(),
    supabase
      .from("test_attempt_answers")
      .select("question_key,answer,is_correct,points_awarded,answer_revision")
      .eq("attempt_id", attemptId),
    supabase
      .from("test_attempts")
      .select("id", { count: "exact", head: true })
      .eq("assignment_id", assignmentId)
      .eq("student_id", current.user.id)
      .not("submitted_at", "is", null),
  ]);

  if (assignment.error) console.error("Не удалось загрузить назначение попытки:", { code: assignment.error.code, message: assignment.error.message });
  if (assignment.error || !assignment.data) return <DeletedTestState />;
  if (
    attempt.error ||
    answersResult.error ||
    submittedAttemptsResult.error ||
    !attempt.data ||
    !isSnapshot(assignment.data.snapshot)
  ) {
    return <DeletedTestState />;
  }

  const deadlinePassed = Boolean(assignment.data.deadline_at && new Date(assignment.data.deadline_at) <= new Date());
  if (!attempt.data.submitted_at && deadlinePassed) {
    const finalized = await admin.rpc("finalize_student_test_attempt_if_expired", { p_attempt_id: attemptId });
    const status = (finalized.data as { status?: string } | null)?.status;
    if (!finalized.error && (status === "finalized" || status === "already_submitted")) redirect(`/student/tests/${assignmentId}/attempts/${attemptId}`);
    if (finalized.error) console.error("Не удалось автоматически завершить просроченную попытку:", { code: finalized.error.code, message: finalized.error.message });
  }

  const test = assignment.data.snapshot;
  const answerMap = new Map<string, StudentAnswer>();
  const answerRevisions = new Map<string, number>();
  for (const row of answersResult.data) {
    const question = test.questions.find(
      (item) => item.key === row.question_key,
    );
    if (question && isStudentAnswer(row.answer, question)) {
      answerMap.set(row.question_key, row.answer);
      answerRevisions.set(row.question_key, Number(row.answer_revision) || 0);
    }
  }

  const paths = [
    ...new Set(
      test.questions
        .map((question) => question.imagePath)
        .filter((path): path is string => Boolean(path)),
    ),
  ];
  const urls = new Map<string, string>();
  if (paths.length) {
    const signed = await admin.storage.from("test-images").createSignedUrls(paths, 3600);
    if (signed.error) console.error("Не удалось получить signed URLs изображений теста:", { name: signed.error.name, message: signed.error.message });
    else for (const item of signed.data) if (!item.error && item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }

  if (attempt.data.submitted_at) {
    const submittedAttemptsCount = submittedAttemptsResult.count ?? 0;
    const deadlineHasPassed = Boolean(
      assignment.data.deadline_at &&
        new Date(assignment.data.deadline_at) <= new Date(),
    );
    const canRevealCorrectAnswers =
      assignment.data.show_correct_answers_after_close &&
      (submittedAttemptsCount >= assignment.data.max_attempts ||
        deadlineHasPassed);

    return (
      <ResultView
        title={assignment.data.title}
        snapshot={test}
        attempt={attempt.data}
        answers={answerMap}
        imageUrls={Object.fromEntries(urls)}
        showCorrect={canRevealCorrectAnswers}
      />
    );
  }

  const safeTest: SafeStudentTest = {
    assignmentId,
    title: assignment.data.title,
    description: test.description,
    questions: test.questions.map((question) => {
      const common = { key: question.key, prompt: question.prompt, imageUrl: question.imagePath ? (urls.get(question.imagePath) ?? null) : null, points: question.points, required: question.required, position: question.position };
      if (question.type === "MATCHING") return { ...common, type: question.type, matching: { allowOptionReuse: question.matching.allowOptionReuse, leftItems: question.matching.leftItems.map(({ key, label, text, position }) => ({ key, label, text, position })), options: question.matching.options } };
      if (question.type === "MULTI_PART") return { ...common, type: question.type, multiPart: { parts: question.multiPart.parts.map((part) => ({ key: part.key, label: part.label, prompt: part.prompt, type: part.type, points: part.points, position: part.position, options: part.options.map(({ key, text, position }) => ({ key, text, position })) })) } };
      return { ...common, type: question.type, options: question.options.map(({ key, text, position }) => ({ key, text, position })) };
    }),
  };

  return (
    <TestRunner
      test={safeTest}
      attemptId={attemptId}
      initialAnswers={Object.fromEntries(answerMap)}
      initialRevisions={Object.fromEntries(answerRevisions)}
      deadlineAt={assignment.data.deadline_at}
    />
  );
}

type ResultAttempt = {
  attempt_number: number;
  submitted_at: string | null;
  score: number | null;
  max_score: number | null;
  correct_count: number | null;
  incorrect_count: number | null;
  unanswered_count: number | null;
};

function ResultView({
  title,
  snapshot,
  attempt,
  answers,
  imageUrls,
  showCorrect,
}: {
  title: string;
  snapshot: TestSnapshot;
  attempt: ResultAttempt;
  answers: Map<string, StudentAnswer>;
  imageUrls: Record<string, string>;
  showCorrect: boolean;
}) {
  const result = gradeStudentAttempt(snapshot, answers);
  const score = Number(attempt.score ?? result.score);
  const max = Number(attempt.max_score ?? result.maxScore);
  const percent = max > 0 ? Math.round((score / max) * 100) : 0;
  const date = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    dateStyle: "long",
    timeStyle: "short",
  });

  return (
    <div className={styles.result}>
      <BackLink href="/student/tests">К тестам</BackLink>
      <header>
        <div className={styles.resultHeading}>
          <div>
            <span>Тест завершён</span>
            <h1>{title}</h1>
          </div>
          <div className={styles.score}>
            <span>Результат</span>
            <strong>{percent}%</strong>
            <small>
              {score} из {max} баллов
            </small>
          </div>
        </div>
        {attempt.submitted_at && (
          <p>Отправлено {date.format(new Date(attempt.submitted_at))}</p>
        )}
        <div className={styles.stats}>
          <span>Правильно: {attempt.correct_count ?? result.correct}</span>
          <span>Неправильно: {attempt.incorrect_count ?? result.incorrect}</span>
          <span>Пропущено: {attempt.unanswered_count ?? result.unanswered}</span>
        </div>
      </header>

      <TestAttemptReview
        snapshot={snapshot}
        answers={answers}
        imageUrls={imageUrls}
        showCorrect={showCorrect}
      />
    </div>
  );
}
