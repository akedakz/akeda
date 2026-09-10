"use client";

import { useActionState, useEffect, useRef } from "react";
import { createStudent, type CreateStudentState } from "./actions";
import styles from "./students.module.css";

const initialState: CreateStudentState = {
  status: "idle",
  message: "",
};

type StudentFormProps = {
  onCancel: () => void;
  onSuccess: (message: string) => void;
};

export default function StudentForm({ onCancel, onSuccess }: StudentFormProps) {
  const [state, formAction, isPending] = useActionState(
    createStudent,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      onSuccess(state.message);
    }
  }, [onSuccess, state]);

  const handleCancel = () => {
    formRef.current?.reset();
    onCancel();
  };

  return (
    <form
      ref={formRef}
      action={formAction}
      className={styles.form}
      noValidate
    >
      <div className={styles.field}>
        <label htmlFor="full_name">Имя ученика</label>
        <input
          ref={nameInputRef}
          id="full_name"
          name="full_name"
          type="text"
          autoComplete="name"
          disabled={isPending}
          required
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="student-email">Email</label>
        <input
          id="student-email"
          name="email"
          type="email"
          autoComplete="email"
          disabled={isPending}
          required
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="student-password">Временный пароль</label>
        <input
          id="student-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          disabled={isPending}
          required
        />
      </div>
      <div className={styles.formActions}>
        <button
          className={styles.submit}
          type="submit"
          disabled={isPending}
          aria-busy={isPending}
        >
          {isPending ? "Создаём…" : "Создать ученика"}
        </button>
        <button className={styles.cancel} type="button" onClick={handleCancel} disabled={isPending}>
          Отмена
        </button>
      </div>
      <p
        className={state.status === "success" ? styles.success : styles.error}
        role={state.status === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {state.message || "\u00A0"}
      </p>
    </form>
  );
}
