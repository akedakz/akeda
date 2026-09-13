import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import LoginForm from "./login-form";
import styles from "./login.module.css";

export const metadata: Metadata = {
  title: "Вход — AKEDA",
  description: "Вход в личную учебную платформу AKEDA.",
};

export default async function LoginPage() {
  const current = await getCurrentProfile();
  if (current?.profile?.role === "ADMIN") redirect("/admin");
  if (current?.profile?.role === "STUDENT") redirect("/student");
  if (current) redirect("/dashboard");

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="login-title">
        <div className={styles.cardTop}>
          <Link className={styles.brand} href="/" aria-label="AKEDA — на главную">
            <span className={styles.brandMark}>A</span>
            <span>AKEDA</span>
          </Link>
          <span className={styles.accentDot} aria-hidden="true" />
        </div>
        <div className={styles.cardHeading}>
          <h1 id="login-title">Вход в аккаунт</h1>
        </div>
        <LoginForm />
        <Link className={styles.backLink} href="/">
          <span aria-hidden="true">←</span> Вернуться на главную
        </Link>
      </section>
    </main>
  );
}
