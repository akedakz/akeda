"use client";

import { useState, useTransition } from "react";
import { formatKzt } from "@/lib/finance/types";
import { reviewKaspiPaymentClaim } from "./claim-actions";
import styles from "./payment-claims.module.css";

export type PaymentClaimItem = {
  id: string;
  studentName: string;
  reporterName: string;
  amountKzt: number;
  createdAt: string;
};

export default function PaymentClaims({ claims }: { claims: PaymentClaimItem[] }) {
  const [items, setItems] = useState(claims);
  const [notice, setNotice] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dateTime = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    dateStyle: "medium",
    timeStyle: "short",
  });

  function review(id: string, decision: "CONFIRM" | "REJECT") {
    setPendingId(id);
    setNotice("");
    startTransition(async () => {
      const result = await reviewKaspiPaymentClaim(id, decision);
      setNotice(result.message);
      if (result.ok) setItems((current) => current.filter((item) => item.id !== id));
      setPendingId(null);
    });
  }

  return (
    <section className={styles.section}>
      <header>
        <div>
          <span>Kaspi</span>
          <h2>Заявки об оплате</h2>
          <p>Сверьте платёж в Kaspi и подтвердите его здесь.</p>
        </div>
        <strong>{items.length}</strong>
      </header>

      {notice && <p className={styles.notice} role="status">{notice}</p>}

      {items.length ? (
        <div className={styles.list}>
          {items.map((claim) => {
            const rowPending = pending && pendingId === claim.id;
            return (
              <article key={claim.id}>
                <div className={styles.identity}>
                  <strong>{claim.studentName}</strong>
                  <span>Сообщил: {claim.reporterName}</span>
                  <time>{dateTime.format(new Date(claim.createdAt))}</time>
                </div>
                <b>{formatKzt(claim.amountKzt)}</b>
                <div className={styles.actions}>
                  <button disabled={pending} onClick={() => review(claim.id, "CONFIRM")}>
                    {rowPending ? "Сохраняем…" : "Подтвердить"}
                  </button>
                  <button className={styles.reject} disabled={pending} onClick={() => review(claim.id, "REJECT")}>
                    Отклонить
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className={styles.empty}>Новых заявок нет.</p>
      )}
    </section>
  );
}
