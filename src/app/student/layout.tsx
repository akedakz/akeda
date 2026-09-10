import { redirect } from "next/navigation";
import { signOut } from "@/app/dashboard/actions";
import StudentShell from "@/components/student/student-shell";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import styles from "./student.module.css";
import { createStudentAvatarUrl } from "@/lib/avatars/student-avatar";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (current.profile?.role === "ADMIN") redirect("/admin");
  if (current.profile?.role !== "STUDENT") redirect("/dashboard");
  if (current.profile.student_status !== "ACTIVE") return <main className={styles.restricted}><section><span>Кабинет ученика</span><h1>Доступ временно ограничен</h1><p>{current.profile.student_status === "PAUSED" ? "Обучение поставлено на паузу. Обратитесь к администратору, чтобы восстановить доступ." : "Профиль находится в архиве. Обратитесь к администратору."}</p><form action={signOut}><button>Выйти</button></form></section></main>;
  const avatarUrl = await createStudentAvatarUrl(current.profile.avatar_path);
  return <StudentShell name={current.profile.full_name ?? "Ученик"} avatarUrl={avatarUrl}>{children}</StudentShell>;
}
