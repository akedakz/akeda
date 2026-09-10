"use client";

import Link from "next/link";
import BackLink from "@/components/back-link";
import { useState } from "react";
import TestRunner from "@/components/student/tests/test-runner";
import TestAttemptReview from "@/components/tests/test-attempt-review";
import { gradeStudentAttempt } from "@/lib/tests/grade-student-attempt";
import type { SafeStudentTest, StudentAnswer } from "@/lib/tests/student-test-types";
import type { TestSnapshot } from "@/lib/tests/test-snapshot-types";
import styles from "./test-preview.module.css";

export default function TestPreview({
  test,
  snapshot,
  imageUrls,
  returnTo,
}: {
  test: SafeStudentTest;
  snapshot: TestSnapshot;
  imageUrls: Record<string, string>;
  returnTo: string;
}) {
  const [result, setResult] = useState<Record<string, StudentAnswer> | null>(null);

  if (!result) {
    return (
      <div className={styles.previewShell}>
        <div className={styles.backLink}><BackLink href={returnTo}>Назад</BackLink></div>
        <TestRunner
          test={test}
          initialAnswers={{}}
          mode="preview"
          onPreviewFinish={setResult}
        />
      </div>
    );
  }

  const answers = new Map(Object.entries(result));
  const graded = gradeStudentAttempt(snapshot, answers);
  const percent = graded.maxScore > 0 ? Math.round(graded.score / graded.maxScore * 100) : 0;

  return (
    <main className={styles.previewShell}>
      <div className={styles.backLink}><BackLink href={returnTo}>Назад</BackLink></div>
      <section className={styles.resultHero}>
        <span>Результат предпросмотра</span>
        <h1>{graded.score} / {graded.maxScore}</h1>
        <strong>{percent}%</strong>
        <div>
          <p><b>{graded.correct}</b> правильно</p>
          <p><b>{graded.incorrect}</b> неправильно</p>
          <p><b>{graded.unanswered}</b> пропущено</p>
        </div>
        <div className={styles.resultActions}>
          <button type="button" onClick={() => setResult(null)}>Пройти ещё раз</button>
          <Link href={returnTo}>← Назад</Link>
        </div>
      </section>
      <TestAttemptReview snapshot={snapshot} answers={answers} imageUrls={imageUrls} showCorrect />
    </main>
  );
}
