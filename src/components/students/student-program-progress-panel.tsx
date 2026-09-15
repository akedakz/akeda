"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toggleProgramTopicProgress } from "@/app/admin/students/[id]/program-progress-actions";
import ProgramProgressCard from "@/components/programs/program-progress-card";
import type { LearningProgramProgress, ProgramTopicProgressItem } from "@/components/programs/program-progress-types";
import styles from "./student-program-progress-panel.module.css";

export default function StudentProgramProgressPanel({
  studentId,
  programs,
  loadError,
}: {
  studentId: string;
  programs: LearningProgramProgress[];
  loadError?: string | null;
}) {
  const router = useRouter();
  const [pendingTopicId, setPendingTopicId] = useState<string | null>(null);
  const [error, setError] = useState(loadError ?? "");
  const [pending, startTransition] = useTransition();

  function toggle(topic: ProgramTopicProgressItem) {
    if (pending) return;
    setError("");
    setPendingTopicId(topic.id);
    startTransition(async () => {
      const result = await toggleProgramTopicProgress(studentId, topic.id);
      if (!result.ok) setError(result.message);
      else router.refresh();
      setPendingTopicId(null);
    });
  }

  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <div>
          <h2>Программы обучения</h2>
          <p>Прогресс считается по завершённым темам. Незавершённые темы отображаются как «В процессе».</p>
        </div>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      {programs.length ? (
        <div className={styles.list}>
          {programs.map((program) => (
            <ProgramProgressCard
              key={program.id}
              program={program}
              editable
              pendingTopicId={pendingTopicId}
              onToggle={toggle}
            />
          ))}
        </div>
      ) : (
        <p className={styles.empty}>Сначала назначьте ученику программу обучения.</p>
      )}
    </section>
  );
}
