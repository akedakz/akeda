"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import UserAvatar from "@/components/user-avatar";
import Link from "@/components/student/tests/intent-prefetch-link";
import styles from "./mobile-bottom-navigation.module.css";

export type MobileNavigationItem = {
  href: string;
  label: string;
  icon: ReactNode;
  exact?: boolean;
  prefetchMode?: "auto" | "intent";
};

export default function MobileBottomNavigation({ main, more, identity, moreFooter, ariaLabel }: {
  main: readonly MobileNavigationItem[];
  more: readonly MobileNavigationItem[];
  identity: { role: string; name: string; avatarUrl?: string | null };
  moreFooter?: ReactNode;
  ariaLabel: string;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const firstMoreLink = useRef<HTMLAnchorElement>(null);
  const moreActive = more.some((item) => isActive(pathname, item));

  useEffect(() => {
    if (!moreOpen) return;
    firstMoreLink.current?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMoreOpen(false); moreButton.current?.focus(); }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [moreOpen]);

  function renderLink(item: MobileNavigationItem, inMore = false, index = -1) {
    const active = isActive(pathname, item);
    return <Link
      anchorRef={inMore && index === 0 ? firstMoreLink : undefined}
      mode={item.prefetchMode ?? "auto"}
      showPendingLabel={false}
      lockWhilePending
      pendingStyle={{ background: "#e7eee8", color: "#285039", boxShadow: "inset 0 3px #4d7e69", cursor: "wait" }}
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={inMore ? () => setMoreOpen(false) : undefined}
      key={item.href}
    ><span aria-hidden>{item.icon}</span>{inMore ? item.label : <small>{item.label}</small>}</Link>;
  }

  return <nav className={styles.bottom} aria-label={ariaLabel}>
    {main.map((item) => renderLink(item))}
    <button ref={moreButton} className={styles.moreButton} type="button" aria-expanded={moreOpen} aria-haspopup="menu" aria-current={moreActive ? "page" : undefined} onClick={() => setMoreOpen((value) => !value)}><span aria-hidden>•••</span><small>Ещё</small></button>
    {moreOpen && <>
      <button className={styles.backdrop} type="button" aria-label="Закрыть дополнительные разделы" onClick={() => setMoreOpen(false)}/>
      <div className={styles.moreMenu} role="menu" aria-label="Дополнительные разделы">
        <div className={styles.identity}><UserAvatar name={identity.name} avatarUrl={identity.avatarUrl ?? null} size={38}/><span><small>{identity.role}</small><strong>{identity.name}</strong></span></div>
        <strong>Дополнительные разделы</strong>
        {more.map((item, index) => renderLink(item, true, index))}
        {moreFooter && <div className={styles.footer}>{moreFooter}</div>}
      </div>
    </>}
  </nav>;
}

function isActive(pathname: string, item: Pick<MobileNavigationItem, "href" | "exact">) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
