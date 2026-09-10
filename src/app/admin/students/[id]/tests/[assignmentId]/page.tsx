import Link from "next/link";
import BackLink from "@/components/back-link";
import Image from "next/image";
import MathText from "@/components/tests/math-text";
import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { signStoragePathsBatch } from "@/lib/storage/sign-storage-paths-batch";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TestAssignmentRow, TestSnapshot } from "@/lib/tests/test-snapshot-types";
import styles from "./assignment.module.css";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", dateStyle: "long", timeStyle: "short" }).format(new Date(value));
}

function isSnapshot(value: unknown): value is TestSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<TestSnapshot>;
  return (snapshot.version === 1 || snapshot.version === 2) && typeof snapshot.title === "string" && Array.isArray(snapshot.questions);
}

type PageProps = {
  params: Promise<{
    id: string;
    assignmentId: string;
  }>;
};

export default async function AssignmentPage({ params }: PageProps) {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (current.profile?.role !== "ADMIN") redirect("/dashboard");
  const { id, assignmentId } = await params;
  const admin = createAdminClient();
  const { data, error } = await admin.from("test_assignments").select("id, student_id, source_test_id, title, snapshot, deadline_at, max_attempts, show_correct_answers_after_close, created_at").eq("id", assignmentId).eq("student_id", id).maybeSingle();
  if (error) console.error("Не удалось загрузить назначение:", { code: error.code, message: error.message, details: error.details, hint: error.hint });
  if (error || !data) notFound();
  const assignment = data as TestAssignmentRow;
  if (!isSnapshot(assignment.snapshot)) notFound();

  const sourceExistsPromise = (async () => {
    if (!assignment.source_test_id) return false;
    const { data: source, error: sourceError } = await admin.from("tests").select("id").eq("id", assignment.source_test_id).maybeSingle();
    if (sourceError) console.error("Не удалось проверить исходный тест:", { code: sourceError.code, message: sourceError.message, details: sourceError.details, hint: sourceError.hint });
    return Boolean(source);
  })();
  const [sourceExists, imageUrls] = await Promise.all([
    sourceExistsPromise,
    signStoragePathsBatch(admin, "test-images", assignment.snapshot.questions.map((question) => question.imagePath), 60 * 60),
  ]);

  return <>
    <div className={styles.back}><BackLink href={`/admin/students/${id}?tab=tests`}>Назад к тестам ученика</BackLink></div>
    <header className={styles.header}><span>Назначенный тест</span><h1>{assignment.title}</h1><p>Неизменяемая версия теста на момент назначения</p></header>
    <section className={styles.meta} aria-label="Настройки назначения">
      <div><span>Дедлайн</span><strong>{assignment.deadline_at ? formatDate(assignment.deadline_at) : "Без дедлайна"}</strong></div>
      <div><span>Правильные ответы</span><strong>{assignment.show_correct_answers_after_close ? "Показывать после закрытия" : "Не показывать"}</strong></div>
      <div><span>Назначен</span><strong>{formatDate(assignment.created_at)}</strong></div>
    </section>
    {sourceExists && assignment.source_test_id && <Link className={styles.source} href={`/admin/tests/${assignment.source_test_id}`}>Открыть исходный тест</Link>}
    <section className={styles.preview}><div className={styles.previewHeading}><h2>{assignment.snapshot.title}</h2>{assignment.snapshot.description && <p>{assignment.snapshot.description}</p>}</div>
      <div className={styles.questions}>{assignment.snapshot.questions.map((question, index) => <article className={styles.question} key={question.key}><div className={styles.questionTop}><span>Вопрос {index + 1}</span><b>{question.points} б.</b></div><h3><MathText>{question.prompt}</MathText></h3>{question.imagePath && imageUrls.get(question.imagePath) && <Image src={imageUrls.get(question.imagePath)!} alt="" width={900} height={600} unoptimized/>}
        {question.type === "MATCHING" ? <ul>{question.matching.leftItems.map((item) => <li key={item.key}>{item.label}. <MathText>{item.text}</MathText> → {question.matching.options.find((option) => option.key === item.correctOptionKey)?.label}</li>)}</ul> : question.type === "MULTI_PART" ? <ul>{question.multiPart.parts.map((part) => <li key={part.key}>{part.label}) <MathText>{part.prompt}</MathText> · {part.points} б.</li>)}</ul> : question.type === "NUMERIC" ? <p className={styles.numeric}>Числовой ответ · {question.numeric.mode === "EXACT" ? `точное значение ${question.numeric.exactValue}` : question.numeric.mode === "TOLERANCE" ? `${question.numeric.exactValue} ± ${question.numeric.tolerance}` : `от ${question.numeric.rangeMin} до ${question.numeric.rangeMax}`}</p> : <ul>{question.options.map((option) => <li className={option.isCorrect ? styles.correct : undefined} key={option.key}><MathText>{option.text}</MathText>{option.isCorrect && <span>Правильный ответ</span>}</li>)}</ul>}
      </article>)}</div>
    </section>
  </>;
}
