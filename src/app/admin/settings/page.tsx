import { Suspense } from "react";
import Link from "next/link";
import { PageContent, PageContentLoading, PageHeader, PageShell } from "@/components/page-layout/page-layout";
import { createAdminClient } from "@/lib/supabase/admin";
import styles from "./settings.module.css";

export default function SettingsPage() { return <PageShell><PageHeader title="Настройки" description="Управление учебными справочниками и сообщениями."/><PageContent><Suspense fallback={<PageContentLoading label="Загружаем настройки"/>}><SettingsContent/></Suspense></PageContent></PageShell>; }

async function SettingsContent() {
  const count = await createAdminClient().from("support_messages").select("id", { count: "exact", head: true }).eq("status", "NEW");
  const newCount = count.error ? 0 : count.count ?? 0;
  return <section className={styles.section}><h2>Управление</h2><div className={styles.cards}><article className={styles.card}><div><h3>Шаблоны тем</h3><p>Готовые планы тем для быстрого назначения ученикам.</p></div><Link href="/admin/settings/topic-templates">Открыть</Link></article><article className={styles.card}><div><h3>Программы</h3><p>Программы обучения и их назначение ученикам.</p></div><Link href="/admin/settings/programs">Открыть</Link></article><article className={styles.card}><div><h3>Сообщения {newCount > 0 && <b>{newCount}</b>}</h3><p>Сообщения учеников о проблемах.</p></div><Link href="/admin/settings/messages">Открыть</Link></article></div></section>;
}
