"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LibrarySort } from "@/lib/library-sort";
import styles from "./library-sort-menu.module.css";

const options: { value: LibrarySort; label: string; short: string }[] = [
  { value: "created_desc", label: "Сначала новые", short: "Сначала новые" },
  { value: "created_asc", label: "Сначала старые", short: "Сначала старые" },
  { value: "name_asc", label: "По названию А–Я", short: "По названию" },
  { value: "name_desc", label: "По названию Я–А", short: "По названию" },
];

export default function LibrarySortMenu({ value }: { value: LibrarySort }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null), triggerRef = useRef<HTMLButtonElement>(null), router = useRouter();
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLButtonElement>("[aria-checked='true']")?.focus();
    const pointer = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const keyboard = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", keyboard);
    return () => { document.removeEventListener("pointerdown", pointer); document.removeEventListener("keydown", keyboard); };
  }, [open]);

  const select = (sort: LibrarySort) => {
    const url = new URL(window.location.href);
    url.searchParams.set("sort", sort);
    setOpen(false);
    router.push(`${url.pathname}${url.search}`);
  };

  return <div className={styles.sortBar}><div className={styles.menuRoot} ref={rootRef}><button ref={triggerRef} className={styles.trigger} type="button" aria-label="Сортировка" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5h12M6.5 10h7M9 15h2"/></svg><span>{selected.short}</span><b aria-hidden="true">⌄</b></button>{open && <div className={styles.menu} role="menu" aria-label="Режим сортировки">{options.map((option) => <button key={option.value} type="button" role="menuitemradio" aria-checked={option.value === value} onClick={() => select(option.value)}><span>{option.label}</span>{option.value === value && <b aria-hidden="true">✓</b>}</button>)}</div>}</div></div>;
}
