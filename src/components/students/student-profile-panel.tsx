"use client";

import { useEffect, useState, useTransition } from "react";
import { updateStudentPassword, updateStudentProfile } from "@/app/admin/students/[id]/student-profile-actions";
import StudentDeleteButton from "./student-delete-button";
import type { StudentProfileView } from "./student-profile-types";
import styles from "./student-profile-panel.module.css";

const labels = { ACTIVE: "Активен", PAUSED: "Приостановлен", ARCHIVED: "Архивный" } as const;

export default function StudentProfilePanel({ student }: { student: StudentProfileView }) {
  const [profile, setProfile] = useState(student);
  const [editing, setEditing] = useState(false);
  const [editTab, setEditTab] = useState<"main" | "password">("main");
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [pending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const statusLabel = profile.status ? labels[profile.status] : "Не указан";

  useEffect(() => { if (!message) return; const timer = window.setTimeout(() => setMessage(""), 4000); return () => window.clearTimeout(timer); }, [message]);

  function cancel() {
    if (pending) return;
    setEditing(false); setEditTab("main"); setFormError(""); setPassword(""); setConfirmation(""); setShowPassword(false); setShowConfirmation(false);
  }

  function submitProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setFormError("");
    startTransition(async () => {
      const result = await updateStudentProfile(student.id, formData);
      if (!result.ok || !result.profile) { setFormError(result.message); return; }
      setProfile((current) => ({ ...current, ...result.profile }));
      setEditing(false); setEditTab("main"); setMessage(result.message);
    });
  }

  function submitPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setFormError("");
    startTransition(async () => {
      const result = await updateStudentPassword(student.id, formData);
      if (!result.ok) { setFormError(result.message); return; }
      setPassword(""); setConfirmation(""); setMessage(result.message);
    });
  }

  return <section className={styles.panel} aria-labelledby="profile-panel-title">
    <div className={styles.heading}><div><h2 id="profile-panel-title">Ученик</h2><p>{editing ? "Редактирование данных ученика" : "Основная информация и состояние аккаунта"}</p></div>{!editing && <span>Добавлен {new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(new Date(profile.createdAt))}</span>}</div>
    {message && <p className={styles.notice} role="status">{message}</p>}

    {!editing ? <>
      <dl className={styles.details}><div><dt>Имя</dt><dd>{profile.fullName}</dd></div><div><dt>Email</dt><dd>{profile.email}</dd></div><div><dt>Статус</dt><dd><span className={`${styles.badge} ${profile.status ? styles[profile.status.toLowerCase()] : styles.unset}`}>{statusLabel}</span></dd></div></dl>
      <div className={styles.viewActions}><button type="button" className={styles.editButton} onClick={() => { setEditing(true); setEditTab("main"); setFormError(""); }}>Изменить</button><StudentDeleteButton studentId={student.id} studentName={profile.fullName}/></div>
    </> : <>
      <div className={styles.innerTabs} role="tablist" aria-label="Редактирование ученика"><button type="button" role="tab" aria-selected={editTab === "main"} className={editTab === "main" ? styles.selected : undefined} onClick={() => { setEditTab("main"); setFormError(""); }}>Основные данные</button><button type="button" role="tab" aria-selected={editTab === "password"} className={editTab === "password" ? styles.selected : undefined} onClick={() => { setEditTab("password"); setFormError(""); }}>Пароль</button></div>
      {editTab === "main" ? <form className={styles.form} onSubmit={submitProfile}><label><span>Имя</span><input name="fullName" defaultValue={profile.fullName} maxLength={120} required disabled={pending}/></label><label><span>Email</span><input name="email" type="email" defaultValue={profile.email} required disabled={pending}/></label><label><span>Статус</span><select name="status" defaultValue={profile.status ?? "ACTIVE"} disabled={pending}><option value="ACTIVE">Активен</option><option value="PAUSED">Приостановлен</option><option value="ARCHIVED">Архивный</option></select></label>{formError && <p className={styles.formError} role="alert">{formError}</p>}<div className={styles.formActions}><button type="button" className={styles.cancelButton} onClick={cancel} disabled={pending}>Отмена</button><button type="submit" className={styles.saveButton} disabled={pending}>{pending ? "Сохраняем…" : "Сохранить"}</button></div></form> : <form className={styles.form} onSubmit={submitPassword}><label><span>Новый пароль</span><div className={styles.passwordField}><input name="password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} autoComplete="new-password" required disabled={pending}/><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}>{showPassword ? "Скрыть" : "Показать"}</button></div></label><label><span>Подтверждение пароля</span><div className={styles.passwordField}><input name="passwordConfirmation" type={showConfirmation ? "text" : "password"} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={8} autoComplete="new-password" required disabled={pending}/><button type="button" onClick={() => setShowConfirmation((value) => !value)} aria-label={showConfirmation ? "Скрыть подтверждение пароля" : "Показать подтверждение пароля"}>{showConfirmation ? "Скрыть" : "Показать"}</button></div></label>{formError && <p className={styles.formError} role="alert">{formError}</p>}<div className={styles.formActions}><button type="button" className={styles.cancelButton} onClick={cancel} disabled={pending}>Отмена</button><button type="submit" className={styles.saveButton} disabled={pending}>{pending ? "Сохраняем…" : "Сохранить"}</button></div></form>}
    </>}
  </section>;
}
