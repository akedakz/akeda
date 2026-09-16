"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatKzt } from "@/lib/finance/types";
import { loadPendingKaspiPaymentClaims, submitKaspiPaymentClaim, type PendingKaspiPaymentClaim } from "./payment-actions";
import styles from "./parent.module.css";

const KASPI_URL = "https://qr.kaspi.kz/19203306684873211261528510026767795507910";

export default function ParentPaymentCard({
  studentId,
  amountDueKzt,
  pendingClaims,
}: {
  studentId: string;
  amountDueKzt: number;
  pendingClaims: PendingKaspiPaymentClaim[];
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(amountDueKzt > 0 ? String(amountDueKzt) : "");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!pendingClaims.length) return;

    const currentFingerprint = fingerprint(pendingClaims);
    const interval = window.setInterval(async () => {
      const latest = await loadPendingKaspiPaymentClaims(studentId);
      if (latest && fingerprint(latest) !== currentFingerprint) router.refresh();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [pendingClaims, router, studentId]);

  function submit() {
    const value = Number(amount);
    startTransition(async () => {
      const result = await submitKaspiPaymentClaim(studentId, value);
      setNotice(result.message);
      if (result.ok) {
        setAmount("");
        router.refresh();
      }
    });
  }

  return (
    <section className={styles.paymentCard} aria-labelledby="kaspi-payment-title">
      <div className={styles.paymentCopy}>
        <span>Оплата обучения</span>
        <h2 id="kaspi-payment-title">Kaspi</h2>
        <p>Откройте Kaspi, оплатите нужную сумму и затем сообщите об оплате.</p>

        {pendingClaims.length > 0 && (
          <div className={styles.pendingClaims}>
            <strong>Ожидают подтверждения</strong>
            {pendingClaims.map((claim) => (
              <div className={styles.pendingClaim} key={claim.id}>
                <span>{formatKzt(claim.amountKzt)}</span>
                <small>заявка отправлена</small>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.paymentActions}>
        <a className={styles.kaspiButton} href={KASPI_URL} target="_blank" rel="noreferrer">
          Оплатить через Kaspi
        </a>
        <label>
          Сколько вы оплатили, ₸
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={amount}
            disabled={pending}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <button type="button" disabled={pending || !amount} onClick={submit}>
          {pending ? "Отправляем…" : "Я оплатил"}
        </button>
        {notice && <p className={styles.paymentNotice} role="status">{notice}</p>}
      </div>
    </section>
  );
}

function fingerprint(claims: PendingKaspiPaymentClaim[]) {
  return claims.map((claim) => `${claim.id}:${claim.amountKzt}`).join("|");
}
