import Link from "@/components/student/tests/intent-prefetch-link";
import AdminNavLink from "./admin-nav-link";
import AdminAccountMenu from "./admin-account-menu";
import NotificationBell from "@/components/notifications/notification-bell";
import MobileBottomNavigation, { type MobileNavigationItem } from "@/components/navigation/mobile-bottom-navigation";
import AdminNavIcon from "./admin-nav-icon";
import styles from "./admin-sidebar.module.css";

const navigation = [
  { href: "/admin", label: "Обзор", icon: "overview", exact: true },
  { href: "/admin/students", label: "Ученики", icon: "students" },
  { href: "/admin/payments", label: "Оплаты", icon: "payments" },
  { href: "/admin/tests", label: "Тесты", icon: "tests" },
  { href: "/admin/materials", label: "Материалы", icon: "materials" },
  { href: "/admin/trainers", label: "Тренажёры", icon: "trainers" },
  { href: "/admin/analytics", label: "Аналитика", icon: "analytics" },
  { href: "/admin/settings", label: "Настройки", icon: "settings" },
] as const;

const mobileMain = [navigation[0], navigation[1], navigation[3], navigation[4]].map(toMobileItem);
const mobileMore = [navigation[2], navigation[5], navigation[6], navigation[7]].map(toMobileItem);

function Navigation({ className }: { className?: string }) {
  return (
    <nav
      className={`${styles.nav}${className ? ` ${className}` : ""}`}
      aria-label="Административные разделы"
    >
      {navigation.map((item) => (
        <AdminNavLink key={item.href} {...item} />
      ))}
    </nav>
  );
}

function Account({ displayName, className }: { displayName: string; className?: string }) {
  return (
    <footer className={`${styles.account}${className ? ` ${className}` : ""}`}>
      <AdminAccountMenu displayName={displayName}/>
    </footer>
  );
}

export default function AdminSidebar({ displayName }: { displayName: string }) {
  return (
    <><aside className={styles.sidebar}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/admin" mode="auto" showPendingLabel={false} lockWhilePending pendingStyle={{ opacity: .62, cursor: "wait" }} aria-label="AKEDA — обзор">
          <span className={styles.brandMark}>A</span>
          <span><strong>AKEDA</strong><small>Панель администратора</small></span>
        </Link>
        <NotificationBell/>
      </header>

      <Navigation className={styles.desktopNav} />
      <Account displayName={displayName} className={styles.desktopAccount} />

    </aside>
    <MobileBottomNavigation main={mobileMain} more={mobileMore} identity={{ role: "Администратор", name: displayName }} moreFooter={<div className={styles.mobileAccount}><AdminAccountMenu displayName={displayName}/></div>} ariaLabel="Разделы кабинета администратора"/></>
  );
}

function toMobileItem(item: typeof navigation[number]): MobileNavigationItem {
  const prefetchMode = item.href === "/admin/students" || item.href === "/admin/payments" ? "intent" : "auto";
  return { href: item.href, label: item.label, exact: "exact" in item ? item.exact : undefined, prefetchMode, icon: <AdminNavIcon name={item.icon}/> };
}
