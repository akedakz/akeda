"use client";

import type { LearningProgramProgress, ProgramTopicProgressItem } from "./program-progress-types";
import styles from "./program-progress-card.module.css";

export default function ProgramProgressCard({
  program,
  editable = false,
  pendingTopicId = null,
  onToggle,
}: {
  program: LearningProgramProgress;
  editable?: boolean;
  pendingTopicId?: string | null;
  onToggle?: (topic: ProgramTopicProgressItem) => void;
}) {
  return (
    <section className={styles.programCard}>
      <div className={styles.summary}>
        <div className={styles.ringWrap} aria-label={`Прогресс программы ${program.percent}%`}>
          <svg className={styles.ring} viewBox="0 0 44 44" aria-hidden="true">
            <circle className={styles.ringTrack} cx="22" cy="22" r="18" pathLength="100" />
            <circle
              className={styles.ringValue}
              cx="22"
              cy="22"
              r="18"
              pathLength="100"
              strokeDasharray={`${program.percent} ${100 - program.percent}`}
            />
          </svg>
          <div className={styles.ringText}>
            <strong>{program.percent}%</strong>
            <span>{program.completedTopics} из {program.totalTopics}</span>
          </div>
        </div>

        <div className={styles.summaryText}>
          <span>Программа обучения</span>
          <h3>{program.name}</h3>
          <p>
            {program.totalTopics
              ? `${program.completedTopics} из ${program.totalTopics} тем завершено`
              : "Темы программы пока не добавлены"}
          </p>
        </div>
      </div>

      {program.sections.map((section) => section.topics.length > 0 && (
        <div className={styles.programSection} key={section.id}>
          <h4>{section.title}</h4>
          <div className={styles.topicGrid}>
          {section.topics.map((topic) => (
            <TopicCard
              key={topic.id}
              topic={topic}
              editable={editable}
              pending={pendingTopicId === topic.id}
              onToggle={onToggle}
            />
          ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function TopicCard({
  topic,
  editable,
  pending,
  onToggle,
}: {
  topic: ProgramTopicProgressItem;
  editable: boolean;
  pending: boolean;
  onToggle?: (topic: ProgramTopicProgressItem) => void;
}) {
  const completed = Boolean(topic.completedAt);
  const content = (
    <>
      <span className={completed ? styles.topicIconCompleted : styles.topicIconProgress} aria-hidden="true">
        {completed ? "✓" : "●"}
      </span>
      <span className={styles.topicCopy}>
        <strong>{topic.title}</strong>
        <small className={completed ? styles.completedLabel : styles.progressLabel}>
          {completed ? "Завершена" : "В процессе"}
        </small>
      </span>
      {editable && <span className={styles.topicAction}>{pending ? "…" : completed ? "Вернуть" : "Завершить"}</span>}
    </>
  );

  return editable ? (
    <button
      type="button"
      className={`${styles.topicCard} ${completed ? styles.topicCompleted : styles.topicProgress}`}
      disabled={pending}
      onClick={() => onToggle?.(topic)}
      aria-label={completed ? `Вернуть тему «${topic.title}» в процесс` : `Завершить тему «${topic.title}»`}
    >
      {content}
    </button>
  ) : (
    <article className={`${styles.topicCard} ${completed ? styles.topicCompleted : styles.topicProgress}`}>
      {content}
    </article>
  );
}
