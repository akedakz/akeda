import Link from "next/link";
import { testPreviewHref } from "@/lib/tests/preview-return";
import styles from "./test-cards.module.css";
import TestDeleteButton from "./test-delete-button";

export type TestItem = {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string | null;
  questionCount: number;
  maxPoints: number;
};

export default function TestCard({ test, returnTo = "/admin/tests" }: { test: TestItem; returnTo?: string }) {
  return (
    <article className={styles.testCard}>
      <span className={styles.testIcon}>T</span>
      <div className={styles.testCopy}>
        <h3>{test.title}</h3>
        {test.description && <p>{test.description}</p>}
        <div className={styles.testMeta}><span>{test.questionCount} вопросов</span><span>{test.maxPoints} баллов</span><time dateTime={test.updated_at || test.created_at}>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(new Date(test.updated_at || test.created_at))}</time></div>
      </div>
      <div className={styles.testActions}>
          <Link className={styles.openTest} href={`/admin/tests/${test.id}`}>Открыть тест</Link>
          <TestDeleteButton testId={test.id} testTitle={test.title} compact />
          <Link className={styles.previewTest} href={testPreviewHref(test.id, returnTo)} target="_blank" rel="noopener noreferrer">Предпросмотр</Link>
      </div>
    </article>
  );
}
