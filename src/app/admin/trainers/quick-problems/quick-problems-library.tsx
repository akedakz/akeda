"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import MathText from "@/components/tests/math-text";
import {
  addTrainerSkillsFromImport,
  createTrainerFromImport,
  deleteTrainer,
  previewTrainerImport,
  previewTrainerSkillsImport,
  renameTrainer,
} from "../actions";
import type { GeneratedProblem, TrainerDefinition, TrainerSkill, TrainerPreview, TrainerSkillsPreview } from "@/lib/trainers/trainer-import";
import { QUICK_PROBLEMS_CHATGPT_INSTRUCTION } from "@/lib/trainers/quick-problems-chatgpt-instruction";
import { QUICK_PROBLEMS_ADD_SKILLS_CHATGPT_INSTRUCTION } from "@/lib/trainers/quick-problems-add-skills-chatgpt-instruction";
import { releasePending, tryAcquirePending } from "@/lib/ui/pending-guard";
import styles from "../trainers.module.css";
import studentStyles from "@/app/student/trainers/trainers.module.css";
import { CreateGroupButton, MoveTrainerButton, TrainerGroupSection } from "@/components/trainers/trainer-group-ui";
import { groupTrainerItems, type TrainerGroup } from "@/lib/trainers/trainer-groups";

type TrainerCard = {
  id: string;
  title: string;
  description: string;
  definition: TrainerDefinition;
  contentRevision: number;
  updatedAt: string;
  skillCount: number;
  variantCount: number;
  groupId: string | null;
};

function ClipboardButton({ instruction }: { instruction: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [copyState]);
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(instruction);
      else {
        const textarea = document.createElement("textarea");
        textarea.value = instruction;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        try { textarea.select(); if (!document.execCommand("copy")) throw new Error("Copy command failed"); } finally { textarea.remove(); }
      }
      setCopyState("copied");
    } catch { setCopyState("error"); }
  };
  const label = copyState === "copied" ? "Скопировано" : copyState === "error" ? "Не удалось скопировать" : "Инструкция для ChatGPT";
  return <button className={styles.secondary} onClick={copy} aria-live="polite">{label}</button>;
}

function ModalShell({ titleId, pending = false, onClose, children }: { titleId: string; pending?: boolean; onClose: () => void; children: React.ReactNode }) {
  return <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}><section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}>{children}</section></div>;
}

function PreviewSkills({ skills, examples }: { skills: TrainerSkill[]; examples: Record<string, GeneratedProblem[]> }) {
  return <div className={styles.previewSkills}>{skills.map((skill) => <article className={styles.skill} key={skill.key}><h3>{skill.name}</h3><MathText className={styles.formula}>{`$$${skill.formulaLatex}$$`}</MathText>{skill.variants.map((variant) => <section className={styles.variant} key={variant.key}><h4>Найти {variant.answerVariable} · {variant.answerUnit}</h4>{(examples[`${skill.key}.${variant.key}`] ?? []).map((example, index) => <div className={styles.example} key={index}><p>{example.prompt}</p><strong>Ответ: {example.answer} {example.answerUnit}</strong></div>)}</section>)}</article>)}</div>;
}

function ImportDialog({ onClose,groups }: { onClose: () => void;groups:TrainerGroup[] }) {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [preview, setPreview] = useState<TrainerPreview | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [groupId,setGroupId]=useState("");
  const runPreview = () => startTransition(async () => { const result = await previewTrainerImport(raw); if (result.ok) { setPreview(result.preview); setErrors([]); } else { setPreview(null); setErrors(result.errors ?? [result.message]); } });
  const create = () => startTransition(async () => { const result = await createTrainerFromImport(raw,groupId||null); if (result.ok) { router.refresh(); onClose(); } else setErrors(result.errors ?? [result.message]); });
  return <ModalShell titleId="trainer-import-title" pending={pending} onClose={onClose}><header><div><span>NSP_TRAINER_IMPORT_V1</span><h2 id="trainer-import-title">Импорт тренажёра</h2><p>Вставьте JSON. Предпросмотр и создание независимо проверяются на сервере.</p></div><button className={styles.close} onClick={onClose} disabled={pending} aria-label="Закрыть">×</button></header><div className={styles.instructionRow}><ClipboardButton instruction={QUICK_PROBLEMS_CHATGPT_INSTRUCTION} /></div><label className={styles.textareaLabel} htmlFor="trainer-import-json">Вставьте JSON:</label><textarea id="trainer-import-json" value={raw} onChange={(event) => { setRaw(event.target.value); setPreview(null); setErrors([]); }} placeholder="Вставьте NSP_TRAINER_IMPORT_V1 JSON" disabled={pending} /><div className={styles.dialogActions}><button className={styles.primary} onClick={runPreview} disabled={pending || !raw.trim()}>{pending ? "Проверяем…" : "Предпросмотр"}</button><button className={styles.secondary} onClick={onClose} disabled={pending}>Отмена</button></div>{errors.length > 0 && <ErrorList errors={errors} />}{preview && <div className={styles.preview}><div className={styles.previewSummary}><div><small>Название</small><strong>{preview.definition.title}</strong></div><div><small>Формул</small><strong>{preview.skillCount}</strong></div><div><small>Типов задач</small><strong>{preview.variantCount}</strong></div></div><label className={styles.textareaLabel}>Тема<select value={groupId} onChange={e=>setGroupId(e.target.value)}><option value="">Без темы</option>{groups.map(g=><option key={g.id} value={g.id}>{g.title}</option>)}</select></label><PreviewSkills skills={preview.definition.skills} examples={preview.examples} /><button className={styles.primary} onClick={create} disabled={pending}>{pending ? "Создаём…" : "Создать тренажёр"}</button></div>}</ModalShell>;
}

function AddSkillsDialog({ trainer, onClose }: { trainer: TrainerCard; onClose: () => void }) {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [preview, setPreview] = useState<TrainerSkillsPreview | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const runPreview = () => startTransition(async () => { const result = await previewTrainerSkillsImport(trainer.id, trainer.contentRevision, raw); if (result.ok) { setPreview(result.preview); setErrors([]); } else { setPreview(null); setErrors(result.errors ?? [result.message]); } });
  const add = () => startTransition(async () => { const result = await addTrainerSkillsFromImport(trainer.id, trainer.contentRevision, raw); if (result.ok) { onClose(); router.refresh(); } else setErrors(result.errors ?? [result.message]); });
  return <ModalShell titleId="trainer-add-skills-title" pending={pending} onClose={onClose}><header><div><span>NSP_TRAINER_SKILLS_IMPORT_V1</span><h2 id="trainer-add-skills-title">Добавить формулы</h2><p>{trainer.title}</p></div><button className={styles.close} onClick={onClose} disabled={pending} aria-label="Закрыть">×</button></header><div className={styles.instructionRow}><ClipboardButton instruction={QUICK_PROBLEMS_ADD_SKILLS_CHATGPT_INSTRUCTION} /></div><label className={styles.textareaLabel} htmlFor="trainer-skills-import-json">Вставьте NSP_TRAINER_SKILLS_IMPORT_V1:</label><textarea id="trainer-skills-import-json" value={raw} onChange={(event) => { setRaw(event.target.value); setPreview(null); setErrors([]); }} placeholder="Вставьте JSON с новыми skills" disabled={pending} /><div className={styles.dialogActions}><button className={styles.primary} onClick={runPreview} disabled={pending || !raw.trim()}>{pending ? "Проверяем…" : "Предпросмотр"}</button><button className={styles.secondary} onClick={onClose} disabled={pending}>Отмена</button></div>{errors.length > 0 && <ErrorList errors={errors} />}{preview && <div className={styles.preview}><h3 className={styles.addSummary}>Будет добавлено: {preview.skillCount} формул</h3><PreviewSkills skills={preview.skills} examples={preview.examples} /><button className={styles.primary} onClick={add} disabled={pending}>{pending ? "Добавляем…" : "Добавить формулы"}</button></div>}</ModalShell>;
}

function RenameDialog({ trainer, onClose }: { trainer: TrainerCard; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(trainer.title);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const save = () => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) { setError("Название не может быть пустым."); return; }
    if (normalizedTitle.length > 120) { setError("Название должно содержать не более 120 символов."); return; }
    startTransition(async () => {
      const result = await renameTrainer(trainer.id, normalizedTitle);
      if (result.ok) { onClose(); router.refresh(); } else setError(result.message);
    });
  };
  return <ModalShell titleId="trainer-rename-title" pending={pending} onClose={onClose}><header><div><span>Тренажёр</span><h2 id="trainer-rename-title">Переименовать тренажёр</h2></div><button className={styles.close} onClick={onClose} disabled={pending} aria-label="Закрыть">×</button></header><form className={styles.renameForm} onSubmit={(event) => { event.preventDefault(); save(); }}><label htmlFor="trainer-title">Название</label><input id="trainer-title" value={title} onChange={(event) => { setTitle(event.target.value); setError(""); }} maxLength={120} autoFocus disabled={pending} />{error && <p className={styles.renameError} role="alert">{error}</p>}<div className={styles.renameActions}><button className={styles.secondary} type="button" onClick={onClose} disabled={pending}>Отмена</button><button className={styles.primary} type="submit" disabled={pending}>{pending ? "Сохраняем…" : "Сохранить"}</button></div></form></ModalShell>;
}

function ErrorList({ errors }: { errors: string[] }) {
  return <div className={styles.errors} role="alert"><strong>Нужно исправить:</strong><ul>{errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div>;
}

function DeleteDialog({ trainer, onClose }: { trainer: TrainerCard; onClose: () => void }) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const pendingGuard = useRef(false);
  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => cancelRef.current?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pendingGuard.current) onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener("keydown", keydown); };
  }, [onClose, pending]);
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (confirmation !== "DELETE" || !tryAcquirePending(pendingGuard)) return;
    setError("");
    startTransition(async () => {
      try { const result = await deleteTrainer(trainer.id); if (result.ok) { onClose(); router.refresh(); } else setError(result.message); }
      catch { setError("Не удалось удалить тренажёр."); }
      finally { releasePending(pendingGuard); }
    });
  };
  const safeClose = () => { if (!pendingGuard.current) onClose(); };
  return <div className={styles.deleteBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) safeClose(); }}><div ref={dialogRef} className={styles.deleteModal} role="dialog" aria-modal="true" aria-labelledby="delete-trainer-title" aria-describedby="delete-trainer-description"><h2 id="delete-trainer-title">Удалить тренажёр?</h2><p id="delete-trainer-description">Тренажёр «{trainer.title}» будет удалён.</p><p>Незавершённые назначения этого тренажёра у учеников исчезнут. Уже завершённые результаты 100% сохранятся.</p><form onSubmit={submit} aria-busy={pending}><label><span>Чтобы подтвердить удаление, введите DELETE:</span><input value={confirmation} onChange={(event) => { setConfirmation(event.target.value); setError(""); }} autoComplete="off" disabled={pending} /></label>{error && <p className={styles.deleteError} role="alert">{error}</p>}<div className={styles.deleteActions}><button ref={cancelRef} type="button" className={styles.secondary} onClick={safeClose} disabled={pending}>Отмена</button><button type="submit" className={styles.confirmDelete} disabled={pending || confirmation !== "DELETE"}>{pending ? "Удаление…" : "Удалить тренажёр"}</button></div></form></div></div>;
}

export default function QuickProblemsLibrary({ trainers,groups }: { trainers: TrainerCard[];groups:TrainerGroup[] }) {
  const [importOpen, setImportOpen] = useState(false);
  const [addTrainer, setAddTrainer] = useState<TrainerCard | null>(null);
  const [renameTarget, setRenameTarget] = useState<TrainerCard | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TrainerCard | null>(null);
  const grouped=groupTrainerItems(groups,trainers,true); const card=(trainer:TrainerCard)=><article className={`${studentStyles.trainerRow} ${styles.adminTrainerRow}`} key={trainer.id}><div className={studentStyles.trainerRowHeading}><h3>{trainer.title}</h3></div><p className={styles.trainerMetadata}>Формул: <strong>{trainer.skillCount}</strong><span>·</span>Задач: <strong>{trainer.variantCount}</strong></p><div className={styles.adminTrainerActions}><Link className={styles.rowPrimary} href={`/admin/trainers/quick-problems/${trainer.id}`}>Контент</Link><Link className={styles.rowSecondary} href={`/admin/trainers/quick-problems/${trainer.id}/preview`}>Предпросмотр</Link><button className={styles.rowSecondary} onClick={() => setAddTrainer(trainer)}>Добавить</button><MoveTrainerButton trainerId={trainer.id} title={trainer.title} currentGroupId={trainer.groupId} groups={groups}/><button className={styles.rowSecondary} onClick={() => setRenameTarget(trainer)}>Переименовать</button><button className={styles.rowDelete} onClick={() => setDeleteTarget(trainer)}>Удалить</button></div></article>;
  return <><header className={studentStyles.quickProblemsPageHero}><div className={studentStyles.quickProblemsHeroContent}><span>Тренажёры</span><h1>Quick Problems</h1><p>Быстрые задачи по формулам</p><div className={styles.heroActionSlot}><div className={styles.headerActions}><CreateGroupButton trainerType="QUICK_PROBLEMS"/><button className={styles.primary} onClick={() => setImportOpen(true)}>Импортировать</button></div></div></div></header><section className={studentStyles.trainerList}>{grouped.map((group,index)=><TrainerGroupSection key={group.id??"ungrouped"} title={group.title} count={group.items.length} adminGroup={group.id?groups.find(g=>g.id===group.id):undefined} canMoveUp={group.id!==null&&index>0} canMoveDown={group.id!==null&&index<groups.length-1}>{group.items.length?group.items.map(card):<p className={styles.empty}>В этой теме пока нет тренажёров.</p>}</TrainerGroupSection>)}</section>{importOpen && <ImportDialog groups={groups} onClose={() => setImportOpen(false)} />}{addTrainer && <AddSkillsDialog trainer={addTrainer} onClose={() => setAddTrainer(null)} />}{renameTarget && <RenameDialog trainer={renameTarget} onClose={() => setRenameTarget(null)} />}{deleteTarget && <DeleteDialog trainer={deleteTarget} onClose={() => setDeleteTarget(null)} />}</>;
}
