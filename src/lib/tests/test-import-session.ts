import "server-only";

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabaseAdminEnv } from "@/lib/supabase/env";

export type ImportToken = { version: 1; testId: string; adminId: string; createdAt: string; rawDigest: string; nonce: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const imageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const maxImageSize = 10 * 1024 * 1024;
const storageBucket = "test-images";

export function digestTestImport(raw: string) {
  return createHash("sha256").update(raw).digest("base64url");
}

function signingKey() {
  return getSupabaseAdminEnv().supabaseSecretKey;
}

export function signImportToken(payload: ImportToken) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", signingKey()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyImportToken(token: string, testId: string, adminId: string, raw?: string): ImportToken | null {
  try {
    const [encoded, suppliedSignature, extra] = token.split(".");
    if (!encoded || !suppliedSignature || extra) return null;
    const expectedSignature = createHmac("sha256", signingKey()).update(encoded).digest();
    const supplied = Buffer.from(suppliedSignature, "base64url");
    if (supplied.length !== expectedSignature.length || !timingSafeEqual(supplied, expectedSignature)) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<ImportToken>;
    if (payload.version !== 1 || payload.testId !== testId || payload.adminId !== adminId || !payload.createdAt || !payload.rawDigest || !payload.nonce || !uuid.test(payload.nonce)) return null;
    if (raw !== undefined && payload.rawDigest !== digestTestImport(raw)) return null;
    return payload as ImportToken;
  } catch {
    return null;
  }
}

export function importStoragePrefix(payload: ImportToken) {
  return `tests/${payload.testId}/questions/import-${payload.nonce}`;
}

export async function uploadTestImportImageRequest(testId: string, importToken: string, questionKey: string, file: unknown): Promise<{ ok: true; imagePath: string } | { ok: false; message: string }> {
  const current = await getCurrentProfile();
  const adminId = current?.profile?.role === "ADMIN" ? current.profile.id : null;
  const payload = adminId && uuid.test(testId) ? verifyImportToken(importToken, testId, adminId) : null;
  if (!adminId || !payload) return { ok: false, message: "Недостаточно прав для загрузки изображения импорта." };
  const admin = createAdminClient();
  const [session, test] = await Promise.all([
    admin.from("test_import_sessions").select("test_id").eq("test_id", testId).eq("admin_id", adminId).eq("storage_prefix", importStoragePrefix(payload)).eq("cleanup_pending", false).maybeSingle(),
    admin.from("tests").select("id").eq("id", testId).eq("created_by", adminId).eq("status", "DRAFT").eq("created_at", payload.createdAt).maybeSingle(),
  ]);
  if (session.error || !session.data) return { ok: false, message: "Сессия импорта не найдена." };
  if (test.error || !test.data) {
    if (test.error) console.error("Не удалось подтвердить черновик перед загрузкой изображения импорта:", test.error);
    return { ok: false, message: "Черновик импорта не найден." };
  }
  if (!(file instanceof File) || !imageTypes.has(file.type) || file.size <= 0 || file.size > maxImageSize) return { ok: false, message: "Выберите PNG, JPEG, WEBP или GIF размером до 10 МБ." };
  const safeQuestionKey = questionKey.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  if (!safeQuestionKey) return { ok: false, message: "Некорректный идентификатор вопроса." };
  const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }[file.type];
  const imagePath = `${importStoragePrefix(payload)}/${safeQuestionKey}-${randomUUID()}.${extension}`;
  const uploaded = await admin.storage.from(storageBucket).upload(imagePath, file, { contentType: file.type, upsert: false });
  if (uploaded.error) {
    console.error("Не удалось загрузить изображение импорта:", uploaded.error);
    return { ok: false, message: "Не удалось загрузить изображение импорта." };
  }
  return { ok: true, imagePath };
}
