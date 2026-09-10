import type { ReactNode } from "react";
import Link from "next/link";
import styles from "./back-link.module.css";

export default function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link className={styles.backLink} href={href}><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m12.5 4.5-5 5.5 5 5.5" /></svg><span>{children}</span></Link>;
}
