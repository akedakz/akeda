"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ComponentProps, type CSSProperties, type ReactNode, type Ref } from "react";
import { releasePending, tryAcquirePending } from "@/lib/ui/pending-guard";

type Props = Omit<ComponentProps<typeof Link>, "href" | "children" | "prefetch"> & {
  href: string;
  children: ReactNode;
  anchorRef?: Ref<HTMLAnchorElement>;
  mode?: "auto" | "intent";
  showPendingLabel?: boolean;
  lockWhilePending?: boolean;
  pendingStyle?: CSSProperties;
};

export default function IntentPrefetchLink({ href, children, anchorRef, mode = "intent", showPendingLabel = true, lockWhilePending = true, pendingStyle, onMouseEnter, onFocus, onPointerDown, onClick, onNavigate, style, ...props }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const pendingGuard = useRef(false);
  useEffect(() => {
    releasePending(pendingGuard);
    const reset = window.setTimeout(() => setPending(false), 0);
    return () => window.clearTimeout(reset);
  }, [href, pathname]);
  function prefetch() { if (mode === "intent") router.prefetch(href); }
  return <Link {...props} ref={anchorRef} href={href} prefetch={mode === "intent" ? false : undefined} data-navigation-pending={pending || undefined} aria-busy={pending || undefined} aria-disabled={(lockWhilePending && pending) || props["aria-disabled"]} style={pending ? { ...style, ...pendingStyle } : style} onMouseEnter={(event) => { prefetch(); onMouseEnter?.(event); }} onFocus={(event) => { prefetch(); onFocus?.(event); }} onPointerDown={(event) => { prefetch(); onPointerDown?.(event); }} onClick={onClick} onNavigate={(event) => { if (!lockWhilePending || href === pathname) { onNavigate?.(event); return; } if (!tryAcquirePending(pendingGuard)) { event.preventDefault(); return; } setPending(true); onNavigate?.(event); }}>{pending && showPendingLabel ? "Открываем…" : children}</Link>;
}
