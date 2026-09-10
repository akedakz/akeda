import Link from "next/link";
import styles from "./deleted-test-state.module.css";

export default function DeletedTestState() {
  return <section className={styles.state}>
    <span>Назначенный тест</span>
    <h1>Тест удалён</h1>
    <p>Это назначение больше недоступно.</p>
    <Link href="/student/tests">← Вернуться к тестам</Link>
  </section>;
}
