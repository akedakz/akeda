"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCurrentStudentAvatar, uploadCurrentStudentAvatar } from "@/app/student/profile/actions";
import UserAvatar from "@/components/user-avatar";
import styles from "./student-avatar-editor.module.css";

export default function StudentAvatarEditor({ name, initialUrl }: { name: string; initialUrl: string | null }) {
  const [url, setUrl] = useState(initialUrl);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [message, setMessage] = useState("");
  const [processing, setProcessing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function choose(file: File | undefined) {
    setMessage(""); setBlob(null);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setMessage("Размер изображения не должен превышать 5 МБ."); return; }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setMessage("Можно загрузить JPG, PNG или WebP."); return; }
    setProcessing(true);
    try { const result = await crop(file); setBlob(result.blob); setUrl(result.preview); }
    catch { setMessage("Не удалось обработать изображение."); }
    finally { setProcessing(false); }
  }

  function upload() {
    if (!blob) return;
    start(async () => {
      const data = new FormData(); data.set("avatar", new File([blob], "avatar.webp", { type: "image/webp" }));
      const result = await uploadCurrentStudentAvatar(data); setMessage(result.message);
      if (result.ok) { setUrl(result.url); setBlob(null); router.refresh(); }
    });
  }

  function remove() {
    start(async () => {
      const result = await deleteCurrentStudentAvatar(); setMessage(result.message);
      if (result.ok) { setUrl(null); setBlob(null); setConfirming(false); router.refresh(); }
    });
  }

  return <div className={styles.editor}>
    <UserAvatar name={name} avatarUrl={url} size={112}/>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Загрузить фото профиля" onChange={event => void choose(event.target.files?.[0])}/>
    <div className={styles.buttons}>
      <button type="button" onClick={() => input.current?.click()} disabled={pending || processing}>{processing ? "Обрабатываем…" : initialUrl || url ? "Изменить фото" : "Загрузить фото"}</button>
      {blob && <button type="button" onClick={upload} disabled={pending}>{pending ? "Загружаем…" : "Сохранить"}</button>}
      {(initialUrl || url) && !blob && <button type="button" className={styles.remove} onClick={() => setConfirming(true)} disabled={pending}>Удалить фото</button>}
    </div>
    {message && <b role="status">{message}</b>}
    {confirming && <div className={styles.backdrop}><div role="dialog" aria-modal="true" aria-labelledby="delete-avatar-title"><h3 id="delete-avatar-title">Удалить изображение профиля?</h3><footer><button type="button" onClick={() => setConfirming(false)}>Отмена</button><button type="button" disabled={pending} onClick={remove}>{pending ? "Удаляем…" : "Удалить"}</button></footer></div></div>}
  </div>;
}

async function crop(file: File) {
  const image = await createImageBitmap(file), side = Math.min(image.width, image.height), sx = (image.width - side) / 2, sy = (image.height - side) / 2, canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 512;
  const context = canvas.getContext("2d"); if (!context) throw new Error();
  context.drawImage(image, sx, sy, side, side, 0, 0, 512, 512); image.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(), "image/webp", .86));
  return { blob, preview: canvas.toDataURL("image/webp", .86) };
}
