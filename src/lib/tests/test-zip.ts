import { strFromU8, unzipSync } from "fflate";
import { parseTestImport, type ImportedTest } from "./test-import";

export const TEST_ZIP_LIMITS = {
  maxArchiveBytes: 25 * 1024 * 1024,
  maxImageBytes: 10 * 1024 * 1024,
  maxFiles: 250,
  maxUncompressedBytes: 60 * 1024 * 1024,
  maxJsonBytes: 2 * 1024 * 1024,
} as const;

export type ZipImportResult =
  | { ok: true; raw: string; value: ImportedTest; files: Map<string, File>; warnings: string[] }
  | { ok: false; errors: string[] };

const imagePath = /^images\/([A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|webp|gif))$/i;
const mime = (name: string) => name.toLowerCase().endsWith(".png") ? "image/png" : name.toLowerCase().endsWith(".webp") ? "image/webp" : name.toLowerCase().endsWith(".gif") ? "image/gif" : "image/jpeg";
function hasImageSignature(name: string, data: Uint8Array) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return data.length >= 8 && [137,80,78,71,13,10,26,10].every((byte, index) => data[index] === byte);
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255;
  if (lower.endsWith(".gif")) return data.length >= 6 && (strFromU8(data.subarray(0, 6)) === "GIF89a" || strFromU8(data.subarray(0, 6)) === "GIF87a");
  return lower.endsWith(".webp") && data.length >= 12 && strFromU8(data.subarray(0, 4)) === "RIFF" && strFromU8(data.subarray(8, 12)) === "WEBP";
}

export async function parseTestZip(file: File): Promise<ZipImportResult> {
  if (!file.name.toLowerCase().endsWith(".zip")) return { ok: false, errors: ["Выберите файл ZIP."] };
  if (file.size <= 0 || file.size > TEST_ZIP_LIMITS.maxArchiveBytes) return { ok: false, errors: ["Размер ZIP должен быть не больше 25 МБ."] };
  const errors: string[] = []; const seen = new Set<string>(); let count = 0; let total = 0; let jsonCount = 0;
  let unpacked: Record<string, Uint8Array>;
  try {
    unpacked = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter(entry) {
      const name = entry.name;
      count += 1; total += entry.originalSize;
      if (count > TEST_ZIP_LIMITS.maxFiles) throw new Error("В ZIP больше 250 файлов.");
      if (total > TEST_ZIP_LIMITS.maxUncompressedBytes) throw new Error("Распакованный ZIP превышает 60 МБ.");
      if (!name || name.includes("\\") || name.includes("../") || name.startsWith("/") || /^[A-Za-z]:/.test(name)) throw new Error(`Недопустимый путь в ZIP: ${name || "без имени"}.`);
      if (seen.has(name)) throw new Error(`Файл ${name} встречается в ZIP несколько раз.`); seen.add(name);
      if (name === "test.json") { jsonCount += 1; if (entry.originalSize > TEST_ZIP_LIMITS.maxJsonBytes) throw new Error("test.json превышает 2 МБ."); return true; }
      if (name === "images/") return false;
      const match = imagePath.exec(name);
      if (!match) throw new Error(`Файл ${name} не разрешён в ZIP.`);
      if (entry.originalSize > TEST_ZIP_LIMITS.maxImageBytes) throw new Error(`Изображение ${match[1]} превышает 10 МБ.`);
      return true;
    } });
  } catch (error) { return { ok: false, errors: [error instanceof Error ? error.message : "ZIP не удалось прочитать."] }; }
  if (jsonCount !== 1 || !unpacked["test.json"]) errors.push(jsonCount ? "В корне должен быть ровно один test.json." : "В корне ZIP отсутствует test.json.");
  if (errors.length) return { ok: false, errors };
  let raw = ""; try { raw = strFromU8(unpacked["test.json"]); } catch { return { ok: false, errors: ["test.json должен быть текстовым UTF-8 файлом."] }; }
  const parsed = parseTestImport(raw); if (!parsed.ok) return parsed;
  const files = new Map<string, File>();
  Object.entries(unpacked).forEach(([path, data]) => { const match = imagePath.exec(path); if (match) { if (!hasImageSignature(match[1], data)) errors.push(`${match[1]} не является корректным изображением.`); const bytes = Uint8Array.from(data); files.set(match[1], new File([bytes.buffer], match[1], { type: mime(match[1]) })); } });
  if (errors.length) return { ok: false, errors };
  const required = new Set(parsed.value.images.map((item) => item.filename));
  const missing = [...required].filter((name) => !files.has(name));
  if (missing.length) return { ok: false, errors: missing.map((name) => `Не хватает изображения ${name}.`) };
  const warnings = [...files.keys()].filter((name) => !required.has(name)).map((name) => `${name} не используется`);
  return { ok: true, raw, value: parsed.value, files: new Map([...files].filter(([name]) => required.has(name))), warnings };
}
