"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { sendSupportMessage, signOutToHome, type SupportActionState } from "@/app/student/profile/actions";
import StudentNavIcon from "./student-nav-icon";
import StudentProgressModal from "./progress/student-progress-modal";
import StudentAvatarEditor from "./student-avatar-editor";
import styles from "./student-profile-page.module.css";

const statusLabels = { ACTIVE: "Активен", PAUSED: "Приостановлен", ARCHIVED: "В архиве" } as const;
type Profile = { fullName: string; email: string; status: keyof typeof statusLabels | null; createdLabel: string; programs: string[] };

export default function StudentProfilePage({ profile, avatarUrl }: { profile: Profile; avatarUrl: string | null }) {
  const [reportOpen, setReportOpen] = useState(false);
  return <div className={styles.page}>
    <section className={styles.profileCard} aria-label="Основная информация профиля">
      <StudentAvatarEditor name={profile.fullName} initialUrl={avatarUrl}/>
      <dl className={styles.accountInfo}>
        <div className={styles.nameRow}><dt>Имя и фамилия</dt><dd>{profile.fullName}</dd></div>
        <div><dt>Email</dt><dd>{profile.email}</dd></div>
        <div><dt>Статус</dt><dd><b className={styles.status}>{profile.status ? statusLabels[profile.status] : "Не указан"}</b></dd></div>
        <div><dt>Дата регистрации</dt><dd>{profile.createdLabel}</dd></div>
      </dl>
    </section>

    <div className={styles.grid}>
      <section className={styles.card}>
        <CardTitle icon="materials">Программа обучения</CardTitle>
        {profile.programs.length ? <div className={styles.programs}>{profile.programs.map(program => <span key={program}>{program}</span>)}</div> : <p className={styles.empty}>Программа пока не назначена</p>}
      </section>
      <section className={styles.card}>
        <CardTitle icon="profile">Преподаватель</CardTitle>
        <strong className={styles.teacher}>Адильжан Ажагалиев</strong>
        <a className={styles.whatsapp} href="https://wa.me/77776902712" target="_blank" rel="noopener noreferrer" aria-label="Написать Адильжану Ажагалиеву в WhatsApp по номеру +7 777 690 27 12"><span>WhatsApp</span><b>+7 777 690 27 12</b></a>
      </section>
      <section className={`${styles.card} ${styles.actions}`}>
        <CardTitle icon="assistant">Действия</CardTitle>
        <div className={styles.actionButtons}><button type="button" onClick={() => setReportOpen(true)}>Сообщить о проблеме</button><form action={signOutToHome}><LogoutButton/></form></div>
      </section>
    </div>
    {reportOpen && <SupportForm onClose={() => setReportOpen(false)}/>}
  </div>;
}

function CardTitle({ icon, children }: { icon: "materials" | "profile" | "assistant"; children: string }) {
  return <div className={styles.cardTitle}><span className={styles.icon}><StudentNavIcon name={icon}/></span><h2>{children}</h2></div>;
}

function SupportForm({ onClose }: { onClose: () => void }) {
  const initial: SupportActionState = { ok: false, message: "" };
  const [state, action] = useActionState(sendSupportMessage, initial);
  const [count, setCount] = useState(0);
  return <StudentProgressModal title="Сообщить о проблеме" open onClose={onClose}>{state.ok ? <div className={styles.success}><strong>Сообщение отправлено</strong><p>Спасибо, мы получили ваше сообщение.</p><button type="button" onClick={onClose}>Закрыть</button></div> : <form className={styles.supportForm} action={action}><label>Категория<select name="category" defaultValue="PAGE"><option value="PAGE">Не открывается страница</option><option value="MATERIAL">Проблема с материалом</option><option value="TEST">Проблема с тестом</option><option value="DATA">Ошибка в данных</option><option value="OTHER">Другое</option></select></label><label>Сообщение<textarea name="message" minLength={10} maxLength={2000} required onChange={event => setCount(event.target.value.length)}/><small>{count} / 2000</small></label>{state.message && <p className={styles.formError}>{state.message}</p>}<div className={styles.formActions}><button type="button" onClick={onClose}>Отмена</button><SubmitButton/></div></form>}</StudentProgressModal>;
}

function SubmitButton() { const { pending } = useFormStatus(); return <button type="submit" disabled={pending}>{pending ? "Отправляем…" : "Отправить"}</button>; }
function LogoutButton() { const { pending } = useFormStatus(); return <button className={styles.logout} type="submit" disabled={pending}>{pending ? "Выходим…" : "Выйти"}</button>; }
