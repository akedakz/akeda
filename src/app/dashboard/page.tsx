import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { signOut } from "./actions";
import styles from "./dashboard.module.css";

export const metadata: Metadata = {
  title: "Личный кабинет — AKEDA",
  description: "Личный кабинет пользователя AKEDA.",
};

export default async function DashboardPage() {
  const current = await getCurrentProfile();

  if (!current) {
    redirect("/login");
  }

  if (!current.profile) {
    return (
      <main className={styles.page}>
        <section className={styles.card} aria-labelledby="profile-error-title">
          <div className={styles.cardTop}>
            <Link className={styles.brand} href="/" aria-label="AKEDA — на главную">
              <span className={styles.brandMark}>A</span><span>AKEDA</span>
            </Link>
          </div>
          <div className={styles.content}>
            <span className={styles.eyebrow}>Профиль пользователя</span>
            <h1 id="profile-error-title">Профиль недоступен</h1>
            <div className={styles.userInfo}>Не удалось загрузить профиль. Обратитесь к администратору.</div>
          </div>
          <form action={signOut}><button className={styles.signOut} type="submit">Выйти <span aria-hidden="true">→</span></button></form>
        </section>
      </main>
    );
  }

  if (current.profile.role === "ADMIN") {
    redirect("/admin");
  }

  if (current.profile.role === "STUDENT") {
    redirect("/student");
  }

  return null;
}
