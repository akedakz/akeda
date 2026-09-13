import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageContent, PageContentLoading, PageHeader, PageShell } from "@/components/page-layout/page-layout";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WeeklyPaymentsDashboard } from "@/lib/payments/types";
import { currentAlmatyDate, isMonday, mondayOf } from "@/lib/payments/week";
import PaymentsTracker from "./payments-tracker";
import styles from "./payments.module.css";

export const metadata: Metadata = { title: "Оплаты — AKEDA" };

export default function PaymentsPage({ searchParams }: { searchParams: Promise<{ week?: string | string[] }> }) { return <PageShell><PageHeader title="Оплаты" description="Учёт оплат по неделям и сводные поступления."/><PageContent><Suspense fallback={<PageContentLoading label="Загружаем оплаты"/>}><PaymentsContent searchParams={searchParams}/></Suspense></PageContent></PageShell>; }
async function PaymentsContent({ searchParams }: { searchParams: Promise<{ week?: string | string[] }> }) {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (current.profile?.role !== "ADMIN") redirect("/dashboard");

  const query = await searchParams;
  const requested = Array.isArray(query.week) ? query.week[0] : query.week;
  const currentWeek = mondayOf(currentAlmatyDate())!;
  const weekStart = requested && isMonday(requested) ? requested : currentWeek;
  const { data, error } = await createAdminClient().rpc("get_weekly_payments_dashboard", { p_owner_admin_id: current.profile.id, p_week_start: weekStart });
  const dashboard = data as WeeklyPaymentsDashboard | null;

  return error || dashboard?.status !== "ok"
      ? <section className={styles.loadError}>Не удалось загрузить оплаты. Убедитесь, что новая migration применена.</section>
      : <PaymentsTracker key={`${weekStart}:${dashboard.rows.map(row => row.id).join(",")}`} weekStart={weekStart} currentWeek={currentWeek} initial={dashboard}/>;
}
