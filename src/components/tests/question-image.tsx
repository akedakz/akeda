/* eslint-disable @next/next/no-img-element -- question images use short-lived signed URLs */

import styles from "./question-image.module.css";

export default function QuestionImage({ src, alt = "Изображение к вопросу", loading, fetchPriority }: { src: string; alt?: string; loading?: "eager" | "lazy"; fetchPriority?: "high" | "low" | "auto" }) {
  return <img className={styles.image} style={{ width: "100%", maxWidth: "100%", maxHeight: "none", height: "auto" }} src={src} alt={alt} loading={loading} fetchPriority={fetchPriority} />;
}
