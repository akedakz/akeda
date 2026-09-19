"use client";

import { useState, useTransition } from "react";
import { formatKzt } from "@/lib/finance/types";
import { reviewKaspiPaymentClaim, type ClaimAllocationInput } from "./claim-actions";
import styles from "./payment-claims.module.css";

export type PaymentClaimItem = {
  id: string;
  studentName: string;
  reporterName: string;
  amountKzt: number;
  createdAt: string;
  primaryStudentId: string;
  students: { id: string; name: string }[];
};

export default function PaymentClaims({ claims }: { claims: PaymentClaimItem[] }) {
  const [items, setItems] = useState(claims);
  const [notice, setNotice] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [allocations, setAllocations] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(claims.map((claim) => [claim.id, initialAllocation(claim)])),
  );
  const [pending, startTransition] = useTransition();
  const dateTime = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    dateStyle: "medium",
    timeStyle: "short",
  });

  function review(claim: PaymentClaimItem, decision: "CONFIRM" | "REJECT") {
    const claimAllocations: ClaimAllocationInput[] = decision === "CONFIRM"
      ? claim.students.map((student) => ({
          studentId: student.id,
          amountKzt: Number(allocations[claim.id]?.[student.id] ?? 0),
        })).filter((item) => item.amountKzt > 0)
      : [];
    if (decision === "CONFIRM" && claimAllocations.reduce((sum, item) => sum + item.amountKzt, 0) !== claim.amountKzt) {
      setNotice(`Распределите ровно ${formatKzt(claim.amountKzt)}.`);
      return;
    }
    setPendingId(claim.id);
    setNotice("");
    startTransition(async () => {
      const result = await reviewKaspiPaymentClaim(claim.id, decision, claimAllocations);
      setNotice(result.message);
      if (result.ok) setItems((current) => current.filter((item) => item.id !== claim.id));
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
                <div className={styles.allocations}>
                  <span>Распределение</span>
                  {claim.students.map((student) => (
                    <label key={student.id}>
                      <span>{student.name}</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={allocations[claim.id]?.[student.id] ?? "0"}
                        disabled={pending}
                        onChange={(event) => setAllocations((current) => ({
                          ...current,
                          [claim.id]: { ...current[claim.id], [student.id]: event.target.value },
                        }))}
                      />
                      <i>₸</i>
                    </label>
                  ))}
                </div>
                <div className={styles.actions}>
                  <button disabled={pending || !claim.students.length} onClick={() => review(claim, "CONFIRM")}>
                    {rowPending ? "Сохраняем…" : "Подтвердить"}
                  </button>
                  <button className={styles.reject} disabled={pending} onClick={() => review(claim, "REJECT")}>
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

function initialAllocation(claim: PaymentClaimItem) {
  if (!claim.students.length) return {};
  const base = Math.floor(claim.amountKzt / claim.students.length);
  let remainder = claim.amountKzt - base * claim.students.length;
  return Object.fromEntries(claim.students.map((student) => {
    const extra = student.id === claim.primaryStudentId ? remainder : 0;
    if (extra) remainder = 0;
    return [student.id, String(base + extra)];
  }));
}
