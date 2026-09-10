"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "./lesson-actions-dropdown.module.css";

export type LessonMenuAction = { label: string; onSelect: () => void; danger?: boolean };
type Position = { top: number; left: number; width: number };

export default function LessonActionsDropdown({ actions, label = "Действия урока" }: { actions: LessonMenuAction[]; label?: string }) {
  const [open, setOpen] = useState(false); const [position, setPosition] = useState<Position | null>(null); const buttonRef = useRef<HTMLButtonElement>(null); const menuRef = useRef<HTMLDivElement>(null);
  const updatePosition = useCallback(() => {
    const button = buttonRef.current; if (!button) return;
    const rect = button.getBoundingClientRect(); const width = Math.min(220, window.innerWidth - 16); const measured = menuRef.current?.offsetHeight ?? actions.length * 36 + 10; const roomBelow = window.innerHeight - rect.bottom - 8; const openUp = roomBelow < measured && rect.top > roomBelow;
    setPosition({ top: openUp ? Math.max(8, rect.top - measured - 6) : Math.min(window.innerHeight - measured - 8, rect.bottom + 6), left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)), width });
  }, [actions.length]);
  useLayoutEffect(() => { if (open) updatePosition(); }, [open, updatePosition]);
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]')?.focus());
    const outside = (event: PointerEvent) => { const target = event.target as Node; if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false); };
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); requestAnimationFrame(() => buttonRef.current?.focus()); } };
    window.addEventListener("resize", updatePosition); window.addEventListener("scroll", updatePosition, true); document.addEventListener("pointerdown", outside); document.addEventListener("keydown", keydown);
    return () => { window.removeEventListener("resize", updatePosition); window.removeEventListener("scroll", updatePosition, true); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", keydown); };
  }, [open, updatePosition]);
  function menuKey(event: React.KeyboardEvent<HTMLDivElement>) { const items=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')];const index=items.indexOf(document.activeElement as HTMLButtonElement);if(event.key==="ArrowDown"){event.preventDefault();items[(index+1)%items.length]?.focus()}else if(event.key==="ArrowUp"){event.preventDefault();items[(index-1+items.length)%items.length]?.focus()}else if(event.key==="Home"){event.preventDefault();items[0]?.focus()}else if(event.key==="End"){event.preventDefault();items.at(-1)?.focus()} }
  return <><button ref={buttonRef} className={styles.trigger} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => { if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); setOpen(true); } }}>•••</button>{open && position && createPortal(<div ref={menuRef} className={styles.menu} role="menu" style={position} onKeyDown={menuKey}>{actions.map((action) => <button role="menuitem" type="button" className={action.danger ? styles.danger : undefined} key={action.label} onClick={() => { setOpen(false); action.onSelect(); }}>{action.label}</button>)}</div>, document.body)}</>;
}
