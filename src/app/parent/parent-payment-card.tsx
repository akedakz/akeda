"use client";

import { useState, useTransition } from "react";
import { submitKaspiPaymentClaim } from "./payment-actions";
import { formatKzt } from "@/lib/finance/types";
import styles from "./parent.module.css";

const KASPI_URL = "https://qr.kaspi.kz/19203306684873211261528510026767795507910";

export default function ParentPaymentCard({
  studentId,
  amountDueKzt,
  pendingClaim,
}: {
  studentId: string;
  amountDueKzt: number;
  pendingClaim: { amountKzt: number; createdAt: string } | null;
}) {
  const [amount, setAmount] = useState(String(pendingClaim?.amountKzt ?? Math.max(amountDueKzt, 0) || ""));
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    const value = Number(amount);
    startTransition(async () => {
      const result = await submitKaspiPaymentClaim(studentId, value);
      setNotice(result.message);
    });
  }

  return (
    <section className={styles.paymentCard} aria-labelledby="kaspi-payment-title">
      <div className={styles.paymentCopy}>
        <span>Оплата обучения</span>
        <h2 id="kaspi-payment-title">Kaspi</h2>
        <p>Откройте Kaspi, оплатите нужную сумму и затем сообщите об оплате.</p>
        {pendingClaim && (
          <div className={styles.pendingClaim}>
            <strong>Заявка уже отправлена</strong>
            <span>{formatKzt(pendingClaim.amountKzt)} · ожидает подтверждения</span>
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
          {pending ? "Отправляем…" : pendingClaim ? "Обновить заявку" : "Я оплатил"}
        </button>
        {notice && <p className={styles.paymentNotice} role="status">{notice}</p>}
      </div>
    </section>
  );
}
