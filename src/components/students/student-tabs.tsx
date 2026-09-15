"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { StudentTab } from "./student-tab-types";
import styles from "./student-tabs.module.css";

const items: { value: StudentTab; label: string; icon: string }[] = [
  { value: "student", label: "Ученик", icon: "◉" },
  { value: "lessons", label: "Уроки", icon: "▣" },
  { value: "progress", label: "Прогресс программ", icon: "◫" },
  { value: "materials", label: "Материалы", icon: "◇" },
  { value: "tests", label: "Тесты", icon: "✓" },
  { value: "trainers", label: "Тренажёры", icon: "◎" },
  { value: "results", label: "Результаты", icon: "↗" },
];

export default function StudentTabs({ studentId, activeTab, navigationPending, onNavigate }: { studentId: string; activeTab: StudentTab; navigationPending: boolean; onNavigate: (tab: StudentTab, href: string, event: { preventDefault: () => void }) => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function href(tab: StudentTab) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", tab);
    return `${pathname || `/admin/students/${studentId}`}?${next.toString()}`;
  }

  return <nav className={styles.scroller} aria-label="Разделы ученика" aria-busy={navigationPending}><div className={styles.tabs} role="tablist">
    {items.map((item) => {
      const targetHref = href(item.value);
      return <Link
      href={targetHref}
      prefetch={false}
      scroll={false}
      role="tab"
      aria-selected={item.value === activeTab}
      aria-disabled={navigationPending && item.value !== activeTab}
      className={item.value === activeTab ? styles.active : undefined}
      onNavigate={(event) => onNavigate(item.value, targetHref, event)}
      key={item.value}
    ><span aria-hidden>{item.icon}</span>{item.label}</Link>;
    })}
  </div></nav>;
}
