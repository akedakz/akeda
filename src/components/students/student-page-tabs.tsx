"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PageContentLoading } from "@/components/page-layout/page-layout";
import StudentTabs from "./student-tabs";
import type { StudentTab } from "./student-tab-types";
import { releasePending, tryAcquirePending } from "@/lib/ui/pending-guard";

export default function StudentPageTabs({ studentId, activeTab, children }: { studentId: string; activeTab: StudentTab; children: ReactNode }) {
  const router = useRouter();
  const [selectedTab, setSelectedTab] = useState(activeTab);
  const [pendingTab, setPendingTab] = useState<StudentTab | null>(null);
  const pendingGuard = useRef(false);
  const navigationPending = pendingTab !== null && pendingTab !== activeTab;
  const visibleTab = navigationPending ? selectedTab : activeTab;

  useEffect(() => {
    // The URL/server prop is authoritative for completed navigations and Back/Forward.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedTab(activeTab);
    setPendingTab(null);
    releasePending(pendingGuard);
  }, [activeTab]);

  function navigate(tab: StudentTab, href: string, event: { preventDefault: () => void }) {
    if (pendingGuard.current) { event.preventDefault(); return; }
    if (tab === activeTab) return;
    event.preventDefault();
    if (!tryAcquirePending(pendingGuard)) return;
    setSelectedTab(tab);
    setPendingTab(tab);
    router.push(href, { scroll: false });
  }

  return <>
    <StudentTabs studentId={studentId} activeTab={visibleTab} navigationPending={navigationPending} onNavigate={navigate}/>
    <div className="student-tab-content">{navigationPending ? <PageContentLoading label="Загрузка раздела ученика"/> : children}</div>
  </>;
}
