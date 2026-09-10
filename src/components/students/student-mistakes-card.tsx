import Link from "next/link";
import styles from "./trainer-management.module.css";

export default function StudentMistakesCard({studentId,count,corrected,error}:{studentId:string;count:number;corrected:number;error?:boolean}){
  return <section className={styles.section}><header className={styles.sectionHeader}><span className={styles.icon} aria-hidden="true">✓</span><div className={styles.heading}><strong>Mistake Review</strong><small>{error ? "Не удалось загрузить статистику" : `${count} активных ошибок · ${corrected} исправлено`}</small></div><Link className={styles.primary} href={`/admin/students/${studentId}/mistakes`}>Открыть</Link></header></section>;
}
