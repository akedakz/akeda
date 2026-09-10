import type { ReactNode } from "react";
import styles from "./page-layout.module.css";

export function PageShell({ children }: { children: ReactNode }) { return <div className={styles.shell}>{children}</div>; }
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) { return <header className={styles.header}><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className={styles.actions}>{actions}</div>}</header>; }
export function PageContent({ children, className = "" }: { children: ReactNode; className?: string }) { return <section className={`${styles.content} ${className}`.trim()}>{children}</section>; }
export function PageContentLoading({ label = "Загрузка" }: { label?: string }) { return <div className={styles.loading} role="status" aria-label={label} aria-busy="true"><span aria-hidden="true"/></div>; }
export function PageLoadingSkeleton({ variant = "cards", label = "Загрузка" }: { variant?: "cards" | "table" | "detail"; label?: string }) { const count = variant === "detail" ? 2 : variant === "table" ? 5 : 3; return <div className={styles.skeleton} data-variant={variant} role="status" aria-label={label} aria-busy="true">{Array.from({ length: count }, (_, index) => <i key={index}/>)}</div>; }
export function PageRouteLoading({ title, description, variant = "spinner" }: { title: string; description: string; variant?: "spinner" | "cards" | "table" | "detail" }) { return <PageShell><PageHeader title={title} description={description}/><PageContent>{variant === "spinner" ? <PageContentLoading/> : <PageLoadingSkeleton variant={variant}/>}</PageContent></PageShell>; }
