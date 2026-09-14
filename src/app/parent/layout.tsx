import { redirect } from "next/navigation";
import { signOut } from "@/app/dashboard/actions";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import styles from "./parent.module.css";

export default async function ParentLayout({ children }: { children: React.ReactNode }) {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (current.profile?.role !== "PARENT") redirect("/dashboard");
  return <div className={styles.shell}><header className={styles.topbar}><a href="/parent" className={styles.brand}><b>A</b><span>AKEDA</span></a><div><span>{current.profile.full_name ?? "Родитель"}</span><form action={signOut}><button>Выйти</button></form></div></header>{children}</div>;
}
