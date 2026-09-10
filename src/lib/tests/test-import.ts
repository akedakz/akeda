import type { EditorOption, EditorQuestion, EditorTest, NumericMode } from "@/app/admin/tests/[id]/types";

export const TEST_IMPORT_VERSION = "NSP_TEST_IMPORT_V1";
export { TEST_IMPORT_INSTRUCTION } from "./test-import-instruction";

type Obj = Record<string, unknown>;
export type ImportedTest = { title: string; description: string; questions: ImportedQuestion[]; images: { filename: string; questionKey: string }[] };
export type ImportedQuestion = { key: string; type: string; prompt: string; image: string | null; required: boolean; points: number; options?: Item[]; allowOptionReuse?: boolean; leftItems?: Item[]; parts?: ImportedPart[]; answer: Obj };
type ImportedPart = { key: string; type: string; prompt: string; points: number; options?: Item[]; answer: Obj };
type Item = { key: string; text: string };
export type ImportResult = { ok: true; value: ImportedTest } | { ok: false; errors: string[] };

const types = new Set(["NUMERIC", "SINGLE_CHOICE", "MULTIPLE_CHOICE", "MATCHING", "MULTI_PART"]);
const partTypes = new Set(["NUMERIC", "SINGLE_CHOICE", "MULTIPLE_CHOICE"]);
const filename = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|webp|gif)$/i;
const object = (v: unknown): v is Obj => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && Boolean(v.trim());
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const endsWithUnit = (value: string) => /\([^()\r\n]+\)\s*$/.test(value.trim());

function items(value: unknown, path: string, errors: string[]): Item[] {
  if (!Array.isArray(value) || value.length < 2) { errors.push(`${path}: нужны минимум два варианта.`); return []; }
  const result: Item[] = []; const keys = new Set<string>();
  value.forEach((raw, i) => { if (!object(raw) || !text(raw.key) || !text(raw.text)) errors.push(`${path}[${i + 1}]: нужны непустые key и text.`); else if (keys.has(raw.key)) errors.push(`${path}: ключ ${raw.key} повторяется.`); else { keys.add(raw.key); result.push({ key: raw.key, text: raw.text.trim() }); } });
  return result;
}
function numeric(answer: unknown, path: string, errors: string[]) {
  if (!object(answer) || !["EXACT", "TOLERANCE", "RANGE"].includes(String(answer.mode))) { errors.push(`${path}: некорректный числовой ответ.`); return; }
  if ((answer.mode === "EXACT" || answer.mode === "TOLERANCE") && !finite(answer.value)) errors.push(`${path}: value должен быть числом.`);
  if (answer.mode === "TOLERANCE" && (!finite(answer.tolerance) || answer.tolerance < 0)) errors.push(`${path}: tolerance должен быть неотрицательным числом.`);
  if (answer.mode === "RANGE" && (!finite(answer.min) || !finite(answer.max) || answer.min > answer.max)) errors.push(`${path}: некорректный диапазон.`);
}
function choice(type: string, opts: Item[], answer: unknown, path: string, errors: string[]) {
  const keys = new Set(opts.map((o) => o.key));
  if (!object(answer)) { errors.push(`${path}: отсутствует ответ.`); return; }
  if (type === "SINGLE_CHOICE") { if (!text(answer.optionKey) || !keys.has(answer.optionKey)) errors.push(`${path}: правильный вариант не найден.`); }
  else if (!Array.isArray(answer.optionKeys) || !answer.optionKeys.length || answer.optionKeys.some((k) => typeof k !== "string" || !keys.has(k)) || new Set(answer.optionKeys).size !== answer.optionKeys.length) errors.push(`${path}: некорректный набор правильных вариантов.`);
}

export function parseTestImport(raw: string): ImportResult {
  let root: unknown; try { root = JSON.parse(raw); } catch { return { ok: false, errors: ["JSON не удалось прочитать. Проверьте запятые и кавычки."] }; }
  const errors: string[] = [];
  if (!object(root)) return { ok: false, errors: ["Корень JSON должен быть объектом."] };
  const forbidden = new Set(["id", "clientId", "position", "typeConfig", "imagePath", "imageUrl", "folderId", "created_by", "snapshot"]);
  const inspect = (value: unknown, path: string) => { if (Array.isArray(value)) value.forEach((item, index) => inspect(item, `${path}[${index}]`)); else if (object(value)) Object.entries(value).forEach(([key, item]) => { if (forbidden.has(key)) errors.push(`${path}: внутреннее поле ${key} не разрешено.`); else inspect(item, `${path}.${key}`); }); };
  inspect(root, "JSON");
  if (root.version !== TEST_IMPORT_VERSION) errors.push(`version должен быть ${TEST_IMPORT_VERSION}.`);
  if (!text(root.title)) errors.push("Укажите непустое название теста.");
  if (root.description !== undefined && typeof root.description !== "string") errors.push("description должен быть строкой.");
  if (!Array.isArray(root.questions) || !root.questions.length) errors.push("Добавьте хотя бы один вопрос.");
  if (!object(root.answers)) errors.push("answers должен быть объектом.");
  if (errors.length) return { ok: false, errors };
  const answers = root.answers as Obj; const questions: ImportedQuestion[] = []; const qkeys = new Set<string>(); const images: ImportedTest["images"] = []; const imageNames = new Set<string>();
  (root.questions as unknown[]).forEach((rawQ, index) => {
    const path = `Вопрос ${index + 1}`;
    if (!object(rawQ) || !text(rawQ.key) || !text(rawQ.type) || !text(rawQ.prompt)) { errors.push(`${path}: нужны key, type и prompt.`); return; }
    if ("answer" in rawQ || "correctAnswer" in rawQ || "isCorrect" in rawQ) errors.push(`${path}: правильный ответ должен находиться только в answers.`);
    if (qkeys.has(rawQ.key)) errors.push(`${path}: key ${rawQ.key} повторяется.`); qkeys.add(rawQ.key);
    if (!types.has(rawQ.type)) errors.push(`${path}: тип ${rawQ.type} не поддерживается.`);
    if (!(rawQ.image === undefined || rawQ.image === null || (typeof rawQ.image === "string" && filename.test(rawQ.image)))) errors.push(`${path}: некорректное имя изображения.`);
    if (typeof rawQ.image === "string") { if (imageNames.has(rawQ.image)) errors.push(`${path}: имя изображения ${rawQ.image} повторяется.`); imageNames.add(rawQ.image); images.push({ filename: rawQ.image, questionKey: rawQ.key }); }
    if (rawQ.required !== undefined && typeof rawQ.required !== "boolean") errors.push(`${path}: required должен быть true или false.`);
    if (rawQ.allowOptionReuse !== undefined && typeof rawQ.allowOptionReuse !== "boolean") errors.push(`${path}: allowOptionReuse должен быть true или false.`);
    const answer = answers[rawQ.key]; if (!object(answer)) errors.push(`${path}: отсутствует правильный ответ.`);
    let points = 1; let opts: Item[] | undefined; let left: Item[] | undefined; let parts: ImportedPart[] | undefined;
    if (["NUMERIC","SINGLE_CHOICE","MULTIPLE_CHOICE"].includes(rawQ.type)) { points = rawQ.points === undefined ? 1 : Number(rawQ.points); if (!finite(points) || points <= 0) errors.push(`${path}: points должен быть положительным числом.`); }
    if (rawQ.type === "NUMERIC") { numeric(answer, path, errors); if (!endsWithUnit(rawQ.prompt)) errors.push(`${path}: в конце числового вопроса укажите единицу в скобках.`); }
    if (rawQ.type === "SINGLE_CHOICE" || rawQ.type === "MULTIPLE_CHOICE") { opts = items(rawQ.options, `${path}, варианты`, errors); choice(rawQ.type, opts, answer, path, errors); }
    if (rawQ.type === "MATCHING") { left = items(rawQ.leftItems, `${path}, левая колонка`, errors); opts = items(rawQ.options, `${path}, варианты`, errors); points = left.length; const matches = object(answer) && object(answer.matches) ? answer.matches : null; if (!matches || left.some((x) => !text(matches[x.key]) || !opts!.some((o) => o.key === matches[x.key])) || Object.keys(matches ?? {}).some((k) => !left!.some((x) => x.key === k))) errors.push(`${path}: заполните соответствия для всех элементов.`); else if (rawQ.allowOptionReuse !== true && new Set(Object.values(matches)).size !== left.length) errors.push(`${path}: один вариант нельзя использовать дважды.`); }
    if (rawQ.type === "MULTI_PART") { if (!Array.isArray(rawQ.parts) || !rawQ.parts.length) errors.push(`${path}: добавьте подпункты.`); const partAnswers = object(answer) && object(answer.parts) ? answer.parts : {}; const seen = new Set<string>(); parts = (Array.isArray(rawQ.parts) ? rawQ.parts : []).flatMap((rp, pi) => { const pp = `${path}, подпункт ${pi + 1}`; if (!object(rp) || !text(rp.key) || !text(rp.type) || !text(rp.prompt) || !partTypes.has(rp.type) || !finite(rp.points) || rp.points <= 0) { errors.push(`${pp}: некорректные key, type, prompt или points.`); return []; } if (seen.has(rp.key)) errors.push(`${pp}: key повторяется.`); seen.add(rp.key); const pa = partAnswers[rp.key]; let po: Item[] | undefined; if (rp.type === "NUMERIC") { numeric(pa, pp, errors); if (!endsWithUnit(rp.prompt)) errors.push(`${pp}: в конце числового подпункта укажите единицу в скобках.`); } else { po = items(rp.options, `${pp}, варианты`, errors); choice(rp.type, po, pa, pp, errors); } return [{ key: rp.key, type: rp.type, prompt: rp.prompt.trim(), points: rp.points, options: po, answer: object(pa) ? pa : {} }]; }); if (Object.keys(partAnswers).some((k) => !seen.has(k))) errors.push(`${path}: answers содержит неизвестный подпункт.`); points = parts.reduce((s,p) => s+p.points,0); }
    questions.push({ key: rawQ.key, type: rawQ.type, prompt: rawQ.prompt.trim(), image: typeof rawQ.image === "string" ? rawQ.image : null, required: rawQ.required !== false, points, options: opts, leftItems: left, parts, allowOptionReuse: rawQ.allowOptionReuse === true, answer: object(answer) ? answer : {} });
  });
  Object.keys(answers).forEach((key) => { if (!qkeys.has(key)) errors.push(`answers содержит неизвестный вопрос ${key}.`); });
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { title: (root.title as string).trim(), description: typeof root.description === "string" ? root.description.trim() : "", questions, images } };
}

const uid = () => crypto.randomUUID();
const option = (item: Item, correct: Set<string>, position: number): EditorOption => ({ id: null, clientId: uid(), text: item.text, isCorrect: correct.has(item.key), position });
function numericFields(answer: Obj) { const mode = answer.mode as NumericMode; return { numericMode: mode, numericAnswer: mode === "RANGE" ? null : answer.value as number, numericTolerance: mode === "TOLERANCE" ? answer.tolerance as number : null, numericMin: mode === "RANGE" ? answer.min as number : null, numericMax: mode === "RANGE" ? answer.max as number : null }; }
export function importedToEditor(value: ImportedTest, testId: string, folderId: string | null, imagePaths: Record<string,string>): EditorTest {
  const questions: EditorQuestion[] = value.questions.map((q, position) => { const base: EditorQuestion = { id:null, clientId:uid(), type:q.type as EditorQuestion["type"], prompt:q.prompt, imagePath:q.image ? imagePaths[q.image] : null, imageUrl:null, points:q.points, isRequired:q.required, position, numericMode:null, numericAnswer:null,numericTolerance:null,numericMin:null,numericMax:null,options:[],typeConfig:null };
    if (q.type === "NUMERIC") Object.assign(base, numericFields(q.answer));
    if (q.type === "SINGLE_CHOICE") base.options = q.options!.map((o,i)=>option(o,new Set([q.answer.optionKey as string]),i));
    if (q.type === "MULTIPLE_CHOICE") base.options = q.options!.map((o,i)=>option(o,new Set(q.answer.optionKeys as string[]),i));
    if (q.type === "MATCHING") { const optionKeys = new Map(q.options!.map((o)=>[o.key,uid()])); base.typeConfig={matching:{allowOptionReuse:q.allowOptionReuse!,leftItems:q.leftItems!.map((x,i)=>({key:uid(),label:String.fromCharCode(65+i),text:x.text,position:i,correctOptionKey:optionKeys.get((q.answer.matches as Obj)[x.key] as string)!})),options:q.options!.map((x,i)=>({key:optionKeys.get(x.key)!,label:String(i+1),text:x.text,position:i}))}}; }
    if (q.type === "MULTI_PART") base.typeConfig={multiPart:{parts:q.parts!.map((p,i)=>{ const fields=p.type==="NUMERIC"?numericFields(p.answer):{numericMode:null,numericAnswer:null,numericTolerance:null,numericMin:null,numericMax:null}; const correct=p.type==="SINGLE_CHOICE"?new Set([p.answer.optionKey as string]):new Set((p.answer.optionKeys as string[])??[]); return {key:uid(),label:String.fromCharCode(97+i),prompt:p.prompt,type:p.type as "NUMERIC"|"SINGLE_CHOICE"|"MULTIPLE_CHOICE",points:p.points,position:i,...fields,options:(p.options??[]).map((o,j)=>option(o,correct,j))};})}};
    return base; });
  return { id:testId, folderId, title:value.title, description:value.description, questions, status:"PUBLISHED" };
}
