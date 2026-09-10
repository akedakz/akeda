import styles from "./section-placeholder.module.css";

export default function SectionPlaceholder({ title }: { title: string }) {
  return (
    <section className={styles.section}>
      <span>NSP · Управление</span>
      <h1>{title}</h1>
      <p>Раздел находится в разработке</p>
    </section>
  );
}
