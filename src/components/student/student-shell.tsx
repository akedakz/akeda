import StudentAccountMenu from "./student-account-menu";
import StudentNavigation, { StudentMobileNavigation } from "./student-navigation";
import Link from "./tests/intent-prefetch-link";
import styles from "./student-shell.module.css";
import NotificationBell from "@/components/notifications/notification-bell";

export default function StudentShell({ name, avatarUrl, children }: { name: string; avatarUrl: string|null; children: React.ReactNode }) {
  return <div className={styles.shell}>
    <aside className={styles.sidebar}><Link className={styles.brand} href="/student" mode="auto" showPendingLabel={false} lockWhilePending={false}><i>A</i><span><strong>AKEDA</strong><small>Кабинет ученика</small></span></Link><StudentNavigation/><footer><StudentAccountMenu name={name} avatarUrl={avatarUrl}/></footer></aside>
    <div className={styles.notifications}><NotificationBell/></div>
    <main className={styles.main}>{children}</main>
    <StudentMobileNavigation name={name} avatarUrl={avatarUrl}/>
  </div>;
}
