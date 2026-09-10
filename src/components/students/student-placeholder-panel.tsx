import styles from "./student-placeholder-panel.module.css";

export default function StudentPlaceholderPanel({ title, children, materialAction = false }: { title: string; children: React.ReactNode; materialAction?: boolean }) {
  return <section className={styles.panel}><div><h2>{title}</h2><p>{children}</p></div>{materialAction && <div className={styles.disabledAction}><button type="button" disabled>Назначить материал</button><span>Скоро</span></div>}</section>;
}
