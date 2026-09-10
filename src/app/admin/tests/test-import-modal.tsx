"use client";

import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { beginTestImport, cancelTestImport, finishTestImport } from "./import-actions";
import { runBoundedImportUploads } from "@/lib/tests/bounded-import-uploads";
import { parseTestImport, TEST_IMPORT_INSTRUCTION, type ImportedTest } from "@/lib/tests/test-import";
import { parseTestZip } from "@/lib/tests/test-zip";
import styles from "./test-import-modal.module.css";

type Mode = "json" | "zip";

async function uploadImportImage(testId: string, importToken: string, questionKey: string, file: File) {
  const formData = new FormData();
  formData.set("testId", testId);
  formData.set("importToken", importToken);
  formData.set("questionKey", questionKey);
  formData.set("file", file);
  const response = await fetch("/api/admin/test-import-image", { method: "POST", body: formData });
  const result = await response.json() as { ok: true; imagePath: string } | { ok: false; message: string };
  if (!response.ok || !result.ok) throw new Error(result.ok ? "Не удалось загрузить изображение импорта." : result.message);
  return result.imagePath;
}

export default function TestImportModal({ folderId, onClose }: { folderId: string | null; onClose: () => void }) {
  const router = useRouter(); const zipInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("json"); const [raw, setRaw] = useState(""); const [value, setValue] = useState<ImportedTest | null>(null); const [files, setFiles] = useState<Map<string, File>>(new Map()); const [errors, setErrors] = useState<string[]>([]); const [warnings, setWarnings] = useState<string[]>([]); const [busy, setBusy] = useState(""); const [copied, setCopied] = useState(false); const [dragging, setDragging] = useState(false);
  const resetResult = () => { setValue(null); setFiles(new Map()); setErrors([]); setWarnings([]); };
  const switchMode = (next: Mode) => { if (busy || next === mode) return; setMode(next); setRaw(""); resetResult(); };
  const validateJson = () => { setBusy("Проверяем..."); const result = parseTestImport(raw); if (result.ok) { setValue(result.value); setErrors([]); setWarnings([]); } else { setValue(null); setErrors(result.errors); } setBusy(""); };
  const readZip = async (file: File) => { setBusy("Проверяем ZIP..."); resetResult(); const result = await parseTestZip(file); if (result.ok) { setRaw(result.raw); setValue(result.value); setFiles(result.files); setWarnings(result.warnings); } else setErrors(result.errors); setBusy(""); };
  const drop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file && !busy) void readZip(file); };
  const chooseManualImages = (list: FileList | null) => { const next = new Map<string, File>(); const unused: string[] = []; if (list) for (const file of Array.from(list)) { if (value?.images.some((item) => item.filename === file.name)) next.set(file.name, file); else unused.push(`${file.name} не используется`); } setFiles(next); setWarnings(unused); };
  const missing = value?.images.filter((item) => !files.has(item.filename)) ?? [];
  const submit = async () => { if (!value || missing.length || busy) return; setBusy("Создаём тест..."); let testId = ""; let importToken = ""; try { const start = await beginTestImport(raw, folderId); if (!start.ok) { setErrors(start.errors ?? [start.message]); return; } testId = start.testId; importToken = start.importToken; setBusy(`Загружено 0 из ${value.images.length}`); const paths = await runBoundedImportUploads(value.images, (image) => uploadImportImage(testId, importToken, image.questionKey, files.get(image.filename)!), (completed, total) => setBusy(`Загружено ${completed} из ${total}`)); setBusy("Сохраняем тест..."); const finished = await finishTestImport(testId, importToken, raw, folderId, value.images.map((item, index) => ({ filename: item.filename, path: paths[index] }))); if (!finished.ok) { setErrors(finished.errors ?? [finished.message]); return; } router.push(`/admin/tests/${testId}`); } catch (error) { const messages = [error instanceof Error ? error.message : "Не удалось импортировать тест."]; if (testId && importToken) { const cleanup = await cancelTestImport(testId, importToken); if (!cleanup.ok) messages.push(cleanup.message); } setErrors(messages); } finally { setBusy(""); } };
  const counts = value?.questions.reduce<Record<string, number>>((result, question) => { result[question.type] = (result[question.type] ?? 0) + 1; return result; }, {}) ?? {};
  return <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="import-title">
    <header><div><h2 id="import-title">Импорт теста</h2><p>Загрузите готовый материал для NSP.</p></div><button className={styles.close} onClick={onClose} disabled={Boolean(busy)} aria-label="Закрыть">×</button></header>
    <button className={styles.copy} onClick={async () => { await navigator.clipboard.writeText(TEST_IMPORT_INSTRUCTION); setCopied(true); }}>Скопировать инструкцию для ChatGPT</button>{copied && <span className={styles.success}>Инструкция скопирована</span>}
    <div className={styles.tabs} role="tablist" aria-label="Способ импорта"><button role="tab" aria-selected={mode === "json"} className={mode === "json" ? styles.activeTab : ""} onClick={() => switchMode("json")}>JSON</button><button role="tab" aria-selected={mode === "zip"} className={mode === "zip" ? styles.activeTab : ""} onClick={() => switchMode("zip")}>ZIP</button></div>
    {mode === "json" ? <><textarea className={value ? styles.compactTextarea : styles.textarea} value={raw} onChange={(event) => { setRaw(event.target.value); resetResult(); }} placeholder="Вставьте JSON" disabled={Boolean(busy)} /><div className={styles.actions}><button className={styles.primary} onClick={validateJson} disabled={!raw.trim() || Boolean(busy)}>{busy || "Проверить"}</button><button onClick={onClose} disabled={Boolean(busy)}>Отмена</button></div></> : <><div className={`${styles.dropzone} ${dragging ? styles.dragging : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}><strong>{busy || "Перетащите ZIP сюда"}</strong><span>или</span><button type="button" onClick={() => zipInput.current?.click()} disabled={Boolean(busy)}>Выбрать ZIP</button><input ref={zipInput} type="file" accept=".zip,application/zip" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void readZip(file); event.target.value = ""; }} /></div><button className={styles.cancelZip} onClick={onClose} disabled={Boolean(busy)}>Отмена</button></>}
    {errors.length > 0 && <div className={styles.errors} role="alert"><strong>Нужно исправить:</strong><ul>{errors.slice(0, 20).map((error, index) => <li key={index}>{error}</li>)}</ul></div>}
    {value && <div className={styles.ready}><h3>Тест готов к импорту</h3><p><strong>{value.title}</strong> · {value.questions.length} вопросов · {Object.entries(counts).map(([type, count]) => `${type}: ${count}`).join(" · ")}</p>{value.images.length ? <>{mode === "json" && <label className={styles.upload}>Выберите изображения<input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => chooseManualImages(event.target.files)} disabled={Boolean(busy)} /></label>}<ul className={styles.images}>{value.images.map((item) => <li key={item.filename} className={files.has(item.filename) ? styles.found : styles.missing}>{files.has(item.filename) ? "✓" : "!"} {item.filename} — {files.has(item.filename) ? "найдено" : "не выбрано"}</li>)}</ul></> : <p className={styles.success}>Изображения не требуются.</p>}{warnings.length > 0 && <div className={styles.warnings}>{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}<button className={styles.primary} onClick={submit} disabled={Boolean(busy) || missing.length > 0}>{busy || "Открыть в редакторе"}</button></div>}
  </section></div>;
}
