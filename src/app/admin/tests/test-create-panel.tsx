"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { PageContent, PageHeader, PageShell } from "@/components/page-layout/page-layout";
import { createTest, createTestFolder, type CreateItemState } from "./actions";
import styles from "./tests.module.css";
import TestImportModal from "./test-import-modal";
import BackLink from "@/components/back-link";

type FormKind = "folder" | "test";
const initialCreateItemState: CreateItemState = { status: "idle", message: "" };

function CreateForm({ kind, currentFolderId, onCancel, onSuccess }: { kind: FormKind; currentFolderId: string | null; onCancel: () => void; onSuccess: (state: CreateItemState) => void }) {
  const action = kind === "folder" ? createTestFolder : createTest;
  const [state, formAction, pending] = useActionState(action, initialCreateItemState);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => { firstFieldRef.current?.focus(); }, []);
  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      onSuccess(state);
    }
  }, [onSuccess, state]);

  return (
    <form ref={formRef} action={formAction} className={styles.form} noValidate>
      <input type="hidden" name={kind === "folder" ? "parentId" : "folderId"} value={currentFolderId ?? ""} />
      <div className={styles.field}>
        <label htmlFor={`${kind}-title`}>{kind === "folder" ? "Название папки" : "Название теста"}</label>
        <input ref={firstFieldRef} id={`${kind}-title`} name={kind === "folder" ? "name" : "title"} disabled={pending} required />
      </div>
      {kind === "test" && <div className={`${styles.field} ${styles.descriptionField}`}><label htmlFor="test-description">Короткое описание</label><textarea id="test-description" name="description" rows={3} disabled={pending} /></div>}
      <div className={styles.formActions}>
        <button className={styles.primaryButton} type="submit" disabled={pending}>{pending ? "Создаём…" : kind === "folder" ? "Создать папку" : "Создать тест"}</button>
        <button className={styles.secondaryButton} type="button" disabled={pending} onClick={() => { formRef.current?.reset(); onCancel(); }}>Отмена</button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

function FormMessage({ state }: { state: CreateItemState }) {
  if (state.status === "idle") return null;
  return <p className={state.status === "error" ? styles.formError : styles.formSuccess} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>;
}

export default function TestCreatePanel({ currentFolderId, title, subtitle, breadcrumb, backHref, onCreated, children }: { currentFolderId: string | null; title: string; subtitle: string; breadcrumb: ReactNode; backHref?: string; onCreated?: (state: CreateItemState) => void; children: ReactNode }) {
  const [openForm, setOpenForm] = useState<FormKind | null>(null);
  const [session, setSession] = useState(0);
  const [notice, setNotice] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const close = () => { setOpenForm(null); setSession((value) => value + 1); };
  const toggle = (kind: FormKind) => {
    setNotice("");
    if (openForm === kind) close();
    else setOpenForm(kind);
  };
  const success = (state: CreateItemState) => { setNotice(state.message); onCreated?.(state); close(); };

  return (
    <PageShell>
      <PageHeader title={title} description={subtitle} actions={<>
        <button className={styles.secondaryButton} type="button" onClick={() => toggle("folder")} aria-expanded={openForm === "folder"}>{openForm === "folder" ? "Закрыть форму" : "Создать папку"}</button>
        <button className={styles.primaryButton} type="button" onClick={() => toggle("test")} aria-expanded={openForm === "test"}>{openForm === "test" ? "Закрыть форму" : "Создать тест"}</button>
        <button className={styles.secondaryButton} type="button" onClick={() => { setOpenForm(null); setImportOpen(true); }}>Импортировать тест</button>
      </>}/>
      <PageContent>
      {backHref && <div className={styles.backLink}><BackLink href={backHref}>Назад</BackLink></div>}
      <div className={styles.breadcrumb}>{breadcrumb}</div>
      {openForm && <section className={styles.createPanel} aria-label={openForm === "folder" ? "Создание папки" : "Создание теста"}><div className={styles.formIntro}><span>Новый элемент</span><h2>{openForm === "folder" ? "Создать папку" : "Создать пустой тест"}</h2></div><CreateForm key={`${openForm}-${session}`} kind={openForm} currentFolderId={currentFolderId} onCancel={close} onSuccess={success} /></section>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {children}
      </PageContent>
      {importOpen && <TestImportModal folderId={currentFolderId} onClose={() => setImportOpen(false)} />}
    </PageShell>
  );
}
