"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PageContent, PageHeader, PageShell } from "@/components/page-layout/page-layout";
import StudentForm from "./student-form";
import styles from "./students.module.css";

export default function StudentCreatePanel({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [formSession, setFormSession] = useState(0);
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    if (!successMessage) return;

    const timeout = window.setTimeout(() => setSuccessMessage(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [successMessage]);

  const closeForm = useCallback(() => {
    setIsOpen(false);
    setFormSession((session) => session + 1);
  }, []);

  const handleSuccess = useCallback((message: string) => {
    setSuccessMessage(message);
    setIsOpen(false);
    setFormSession((session) => session + 1);
  }, []);

  const toggleForm = () => {
    if (isOpen) {
      closeForm();
      return;
    }

    setSuccessMessage("");
    setIsOpen(true);
  };

  return (
    <PageShell>
      <PageHeader title="Ученики" description="Управление аккаунтами учеников NSP." actions={
        <button
          className={styles.addLink}
          type="button"
          onClick={toggleForm}
          aria-expanded={isOpen}
          aria-controls="new-student"
        >
          {isOpen ? "Закрыть форму" : "Добавить ученика"}
        </button>
      }/>
      <PageContent>

      {isOpen && (
        <section className={`${styles.panel} ${styles.createPanel}`} id="new-student" aria-labelledby="new-student-title">
          <div className={styles.formHeading}>
            <span>Новый аккаунт</span>
            <h2 id="new-student-title">Добавить ученика</h2>
            <p>Ученик сможет войти с указанными email и временным паролем.</p>
          </div>
          <StudentForm key={formSession} onCancel={closeForm} onSuccess={handleSuccess} />
        </section>
      )}

      {successMessage && (
        <p className={styles.createNotice} role="status" aria-live="polite">
          {successMessage}
        </p>
      )}

      {children}
      </PageContent>
    </PageShell>
  );
}
