"use client";

import { usePathname } from "next/navigation";
import Link from "@/components/student/tests/intent-prefetch-link";
import styles from "./admin-sidebar.module.css";
import AdminNavIcon, { type AdminIconName } from "./admin-nav-icon";

type AdminNavLinkProps = {
  href: string;
  label: string;
  exact?: boolean;
  icon: AdminIconName;
};

const intentPrefetchRoutes = new Set(["/admin/students", "/admin/payments"]);
const pendingStyle = { background: "#e7eee8", color: "#294b35", boxShadow: "inset 3px 0 #4d7e69", cursor: "wait" } as const;

export default function AdminNavLink({
  href,
  label,
  icon,
  exact = false,
}: AdminNavLinkProps) {
  const pathname = usePathname();
  const isActive = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      className={styles.navLink}
      data-active={isActive || undefined}
      href={href}
      mode={intentPrefetchRoutes.has(href) ? "intent" : "auto"}
      aria-current={isActive ? "page" : undefined}
      showPendingLabel={false}
      lockWhilePending
      pendingStyle={pendingStyle}
    >
      <span aria-hidden="true"><AdminNavIcon name={icon}/></span>
      {label}
    </Link>
  );
}
