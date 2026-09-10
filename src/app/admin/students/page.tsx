import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoadingSkeleton } from "@/components/page-layout/page-layout";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StudentStatus } from "@/types/profile";
import StudentCreatePanel from "./student-create-panel";
import styles from "./students.module.css";
import UserAvatar from "@/components/user-avatar";
import { createStudentAvatarUrls } from "@/lib/avatars/student-avatar";
import OpenStudentButton from "./open-student-button";

export const metadata: Metadata = {
  title: "Ученики — NSP",
  description: "Управление учениками NSP.",
};

type StudentProfile = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: "STUDENT";
  created_at: string;
  student_status: StudentStatus | null;
  avatar_path: string | null;
};

const statusOrder: Record<StudentStatus, number> = {
  ACTIVE: 0,
  PAUSED: 1,
  ARCHIVED: 2,
};

const statusLabels: Record<StudentStatus, string> = {
  ACTIVE: "Активный",
  PAUSED: "На паузе",
  ARCHIVED: "В архиве",
};

export default function StudentsPage() { return <StudentCreatePanel><Suspense fallback={<PageLoadingSkeleton variant="table" label="Загружаем учеников"/>}><StudentsContent/></Suspense></StudentCreatePanel>; }
async function StudentsContent() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id, email, full_name, role, student_status, created_at, avatar_path")
    .eq("role", "STUDENT");

  if (error) {
    console.error("Не удалось загрузить учеников из Supabase:", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
  }

  const students = ((data ?? []) as StudentProfile[]).sort((first, second) => {
        const firstStatus = first.student_status ? statusOrder[first.student_status] : 3;
        const secondStatus = second.student_status ? statusOrder[second.student_status] : 3;

        return firstStatus - secondStatus
          || new Date(second.created_at).getTime() - new Date(first.created_at).getTime();
      });
  const avatarUrls = await createStudentAvatarUrls(students.map((student) => student.avatar_path));

  const developmentError = process.env.NODE_ENV === "development" && error
    ? `${error.code || "Supabase error"}: ${error.message}`
    : null;

  return (
        <section className={styles.listPanel} aria-labelledby="students-list-title">
          <h2 id="students-list-title">Список учеников</h2>
          {error ? (
            <p className={styles.empty}>
              Не удалось загрузить список учеников.
              {developmentError && <small className={styles.queryError}>{developmentError}</small>}
            </p>
          ) : students.length === 0 ? (
            <p className={styles.empty}>Учеников пока нет.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>Имя</th><th>Email</th><th>Статус</th><th>Дата добавления</th><th><span className={styles.visuallyHidden}>Действия</span></th></tr></thead>
                <tbody>
                  {students.map((student) => (
                    <tr key={student.id}>
                      <td><span className={styles.studentIdentity} style={{display:"inline-flex",alignItems:"center",gap:10}}><UserAvatar name={student.full_name} avatarUrl={student.avatar_path ? avatarUrls.get(student.avatar_path) ?? null : null} size={42}/><strong>{student.full_name ?? "—"}</strong></span></td>
                      <td>{student.email ?? "—"}</td>
                      <td>
                        <span className={`${styles.status} ${student.student_status ? styles[student.student_status.toLowerCase()] : styles.unset}`}>
                          {student.student_status ? statusLabels[student.student_status] : "Не указан"}
                        </span>
                      </td>
                      <td>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(new Date(student.created_at))}</td>
                      <td><OpenStudentButton studentId={student.id}/></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
  );
}
