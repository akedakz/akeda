import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageContent, PageContentLoading, PageHeader, PageShell } from "@/components/page-layout/page-layout";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WeeklyPaymentsDashboard } from "@/lib/payments/types";
import { currentAlmatyDate, isMonday, mondayOf } from "@/lib/payments/week";
import PaymentClaims, { type PaymentClaimItem } from "./payment-claims";
import PaymentsTracker from "./payments-tracker";
import styles from "./payments.module.css";

export const metadata: Metadata = { title: "Оплаты — AKEDA" };

type ClaimRow = {
  id: string;
  student_id: string;
  reported_by: string;
  amount_kzt: number;
  created_at: string;
};

type ProfileRow = { id: string; full_name: string | null; email: string | null };
type ChildRow = ProfileRow & { parent_id: string | null };

export default function PaymentsPage({ searchParams }: { searchParams: Promise<{ week?: string | string[] }> }) {
  return <PageShell><PageHeader title="Оплаты" description="Заявки Kaspi, учёт оплат по неделям и сводные поступления."/><PageContent><Suspense fallback={<PageContentLoading label="Загружаем оплаты"/>}><PaymentsContent searchParams={searchParams}/></Suspense></PageContent></PageShell>;
}

async function PaymentsContent({ searchParams }: { searchParams: Promise<{ week?: string | string[] }> }) {
  const current = await getCurrentProfile();
  if (!current) redirect("/login");
  if (current.profile?.role !== "ADMIN") redirect("/dashboard");

  const query = await searchParams;
  const requested = Array.isArray(query.week) ? query.week[0] : query.week;
  const currentWeek = mondayOf(currentAlmatyDate())!;
  const weekStart = requested && isMonday(requested) ? requested : currentWeek;
  const admin = createAdminClient();

  const [dashboardResult, claimsResult] = await Promise.all([
    admin.rpc("get_weekly_payments_dashboard", { p_owner_admin_id: current.profile.id, p_week_start: weekStart }),
    admin.from("student_payment_claims").select("id,student_id,reported_by,amount_kzt,created_at").eq("status", "PENDING").order("created_at", { ascending: true }),
  ]);

  if (claimsResult.error) throw claimsResult.error;
  const claimRows = (claimsResult.data ?? []) as ClaimRow[];
  const profileIds = [...new Set(claimRows.flatMap((claim) => [claim.student_id, claim.reported_by]))];
  const profilesResult = profileIds.length
    ? await admin.from("profiles").select("id,full_name,email").in("id", profileIds)
    : { data: [], error: null };
  if (profilesResult.error) throw profilesResult.error;

  const profileById = new Map(((profilesResult.data ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]));
  const reporterIds = [...new Set(claimRows.map((claim) => claim.reported_by))];
  const childrenResult = reporterIds.length
    ? await admin.from("profiles").select("id,parent_id,full_name,email").eq("role", "STUDENT").in("parent_id", reporterIds).order("full_name")
    : { data: [], error: null };
  if (childrenResult.error) throw childrenResult.error;
  const childrenByParent = new Map<string, ChildRow[]>();
  for (const child of (childrenResult.data ?? []) as ChildRow[]) {
    if (!child.parent_id) continue;
    childrenByParent.set(child.parent_id, [...(childrenByParent.get(child.parent_id) ?? []), child]);
  }
  const claims: PaymentClaimItem[] = claimRows.map((claim) => ({
    id: claim.id,
    studentName: displayName(profileById.get(claim.student_id), "Ученик"),
    reporterName: displayName(profileById.get(claim.reported_by), "Родитель"),
    amountKzt: Number(claim.amount_kzt),
    createdAt: claim.created_at,
    primaryStudentId: claim.student_id,
    students: (childrenByParent.get(claim.reported_by) ?? []).map((student) => ({
      id: student.id,
      name: displayName(student, "Ученик"),
    })),
  }));

  const dashboard = dashboardResult.data as WeeklyPaymentsDashboard | null;

  return <>
    <PaymentClaims claims={claims}/>
    {dashboardResult.error || dashboard?.status !== "ok"
      ? <section className={styles.loadError}>Не удалось загрузить недельный учёт оплат.</section>
      : <PaymentsTracker key={`${weekStart}:${dashboard.rows.map(row => row.id).join(",")}`} weekStart={weekStart} currentWeek={currentWeek} initial={dashboard}/>}
  </>;
}

function displayName(profile: ProfileRow | undefined, fallback: string) {
  return profile?.full_name?.trim() || profile?.email || fallback;
}
