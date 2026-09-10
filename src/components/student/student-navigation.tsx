"use client";

import { usePathname } from "next/navigation";
import MobileBottomNavigation, { type MobileNavigationItem } from "@/components/navigation/mobile-bottom-navigation";
import Link from "./tests/intent-prefetch-link";
import StudentNavIcon from "./student-nav-icon";

const mainNavigation = [
  { label: "Главная", icon: "home", href: "/student", exact: true, prefetchMode: "auto" },
  { label: "Материалы", icon: "materials", href: "/student/materials", prefetchMode: "auto" },
  { label: "Тесты", icon: "tests", href: "/student/tests", prefetchMode: "auto" },
  { label: "Тренажёры", icon: "trainers", href: "/student/trainers", prefetchMode: "auto" },
  { label: "Прогресс", icon: "progress", href: "/student/progress", prefetchMode: "intent" },
] as const;

const futureNavigation = [
  { label: "AI-помощник", icon: "assistant", href: "/student/ai-assistant", prefetchMode: "intent" },
] as const;
const profileNavigation = { label: "Профиль", icon: "profile", href: "/student/profile", prefetchMode: "auto" } as const;

export default function StudentNavigation() {
  const pathname = usePathname();
  const navigation = [...mainNavigation, ...futureNavigation, profileNavigation];
  return <nav aria-label="Разделы кабинета">{navigation.map((item) => {
    const active = "exact" in item && item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
    return <Link mode={item.prefetchMode} showPendingLabel={false} lockWhilePending={false} href={item.href} aria-current={active ? "page" : undefined} key={item.href}><span aria-hidden><StudentNavIcon name={item.icon}/></span>{item.label}</Link>;
  })}</nav>;
}

const mobileMain = mainNavigation.slice(0, 4).map(toMobileItem);
const mobileMore = [mainNavigation[4], ...futureNavigation, profileNavigation].map(toMobileItem);

export function StudentMobileNavigation({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  return <MobileBottomNavigation main={mobileMain} more={mobileMore} identity={{ role: "Ученик", name, avatarUrl }} ariaLabel="Разделы кабинета ученика"/>;
}

function toMobileItem(item: typeof mainNavigation[number] | typeof futureNavigation[number] | typeof profileNavigation): MobileNavigationItem {
  return { href: item.href, label: item.label, exact: "exact" in item ? item.exact : undefined, prefetchMode: item.prefetchMode, icon: <StudentNavIcon name={item.icon}/> };
}
