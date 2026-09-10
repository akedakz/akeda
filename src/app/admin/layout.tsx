import { redirect } from "next/navigation";
import AdminSidebar from "@/components/admin/admin-sidebar";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import styles from "./admin-shell.module.css";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const current = await getCurrentProfile();

  if (!current) redirect("/login");
  if (current.profile?.role === "STUDENT") redirect("/student");
  if (current.profile?.role !== "ADMIN") redirect("/dashboard");

  const displayName = current.profile.full_name?.trim() || current.profile.email || current.user.email || "Администратор";
  return (
    <div className={styles.shell}>
      <AdminSidebar displayName={displayName} />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
