import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { signStoragePathsBatch } from "@/lib/storage/sign-storage-paths-batch";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildTestSnapshot } from "@/lib/tests/build-test-snapshot";
import { safePreviewReturnTo } from "@/lib/tests/preview-return";
import type { SafeStudentTest } from "@/lib/tests/student-test-types";
import TestPreview from "./test-preview";
import styles from "./test-preview.module.css";

export default async function TestPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (current.profile?.role !== "ADMIN") redirect("/dashboard");

  const [{ id }, query] = await Promise.all([params, searchParams]);
  const returnTo = safePreviewReturnTo(query.returnTo, id);
  const admin = createAdminClient();
  const built = await buildTestSnapshot(admin, id, current.user.id);
  if (!built.ok) {
    if (built.reason === "not_found") notFound();
    return <div className={styles.serverError}>{built.reason === "empty" ? "В тесте пока нет вопросов." : "Не удалось загрузить предпросмотр."}</div>;
  }

  const imageUrls = await signStoragePathsBatch(admin, "test-images", built.snapshot.questions.map((question) => question.imagePath), 60 * 60);

  const test: SafeStudentTest = {
    assignmentId: `preview:${id}`,
    title: built.snapshot.title,
    description: built.snapshot.description,
    questions: built.snapshot.questions.map((question) => {
      const common = { key: question.key, prompt: question.prompt, imageUrl: question.imagePath ? imageUrls.get(question.imagePath) ?? null : null, points: question.points, required: question.required, position: question.position };
      if (question.type === "MATCHING") return { ...common, type: question.type, matching: { allowOptionReuse: question.matching.allowOptionReuse, leftItems: question.matching.leftItems.map(({ key, label, text, position }) => ({ key, label, text, position })), options: question.matching.options } };
      if (question.type === "MULTI_PART") return { ...common, type: question.type, multiPart: { parts: question.multiPart.parts.map((part) => ({ key: part.key, label: part.label, prompt: part.prompt, type: part.type, points: part.points, position: part.position, options: part.options.map(({ key, text, position }) => ({ key, text, position })) })) } };
      return { ...common, type: question.type, options: question.options.map(({ key, text, position }) => ({ key, text, position })) };
    }),
  };

  return <TestPreview test={test} snapshot={built.snapshot} imageUrls={Object.fromEntries(imageUrls)} returnTo={returnTo} />;
}
