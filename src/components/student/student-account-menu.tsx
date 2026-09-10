"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/dashboard/actions";
import UserAvatar from "@/components/user-avatar";
import styles from "./student-shell.module.css";

export default function StudentAccountMenu({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstItem = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;
    firstItem.current?.focus();
    const onPointerDown = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [open]);

  return <div className={styles.account} ref={root}>
    {open && <div className={styles.accountMenu} role="menu" aria-label="Меню аккаунта">
      <Link ref={firstItem} href="/student/profile" role="menuitem" onClick={() => setOpen(false)}>Профиль</Link>
      <form action={signOut}><button type="submit" role="menuitem">Выйти</button></form>
    </div>}
    <div className={styles.accountSummary}>
      <UserAvatar name={name} avatarUrl={avatarUrl} size={38}/>
      <span><strong title={name}>{name}</strong><small>Ученик</small></span>
      <button ref={trigger} className={styles.accountTrigger} type="button" aria-label="Открыть меню аккаунта" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>•••</button>
    </div>
  </div>;
}
