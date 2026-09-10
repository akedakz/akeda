"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";
import styles from "./login.module.css";

const initialState: LoginState = {
  message: "",
};

export default function LoginForm() {
  const [state, formAction, isPending] = useActionState(login, initialState);

  return (
    <form action={formAction} className={styles.form} id="login-form" noValidate>
      <div className={styles.field}>
        <label htmlFor="email">Электронная почта</label>
        <input id="email" name="email" type="email" autoComplete="email" placeholder="name@example.com" />
      </div>

      <div className={styles.field}>
        <label htmlFor="password">Пароль</label>
        <input id="password" name="password" type="password" autoComplete="current-password" placeholder="Введите пароль" />
      </div>

      <div className={styles.formOptions}>
        <label className={styles.checkbox}>
          <input type="checkbox" name="remember" />
          <span aria-hidden="true" />
          Запомнить меня
        </label>
        <a href="#login-form">Забыли пароль?</a>
      </div>

      <button
        className={styles.submit}
        type="submit"
        disabled={isPending}
        aria-busy={isPending}
      >
        {isPending ? "Входим…" : "Войти"} <span aria-hidden="true">↗</span>
      </button>

      <p className={styles.message} role="alert" aria-live="polite">
        {state.message || "\u00A0"}
      </p>
    </form>
  );
}
