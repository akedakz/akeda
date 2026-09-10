"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import styles from "./students.module.css";

export default function OpenStudentButton({ studentId }: { studentId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const href = `/admin/students/${studentId}`;
  const prefetch = () => router.prefetch(href);

  return <button
    className={styles.openLink}
    type="button"
    disabled={pending}
    aria-label={pending ? "Открываем страницу ученика" : "Открыть страницу ученика"}
    onMouseEnter={prefetch}
    onFocus={prefetch}
    onPointerDown={prefetch}
    onClick={() => { if (!pending) startTransition(() => router.push(href)); }}
  >
    {pending && <span className={styles.openSpinner} aria-hidden="true"/>}
    <span>{pending ? "Открываем…" : "Открыть"}</span>
  </button>;
}
