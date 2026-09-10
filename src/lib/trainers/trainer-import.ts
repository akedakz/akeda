export const TRAINER_IMPORT_VERSION = "NSP_TRAINER_IMPORT_V1" as const;
export const TRAINER_SKILLS_IMPORT_VERSION = "NSP_TRAINER_SKILLS_IMPORT_V1" as const;
export const TRAINER_TYPE = "QUICK_PROBLEMS" as const;

export const TRAINER_LIMITS = {
  rawBytes: 256 * 1024,
  title: 120,
  description: 2_000,
  skills: 50,
  skillName: 120,
  formulaLatex: 500,
  variantsPerSkill: 30,
  promptsPerVariant: 20,
  promptLength: 1_000,
  variablesPerVariant: 30,
  answerUnit: 40,
  expression: 300,
  integerAbs: 1_000_000_000,
  generationRetries: 100,
  validationSamples: 20,
  validationMaxAttempts: 20,
  validationAverageAttempts: 5,
} as const;

type RandomIntVariable = { name: string; kind: "RANDOM_INT"; min: number; max: number };
type DerivedVariable = { name: string; kind: "DERIVED"; expression: string };
export type TrainerVariable = RandomIntVariable | DerivedVariable;
export type TrainerVariant = { key: string; answerVariable: string; answerUnit: string; prompts: string[]; variables: TrainerVariable[] };
export type TrainerSkill = { key: string; name: string; formulaLatex: string; variants: TrainerVariant[] };
export type TrainerDefinition = { version: typeof TRAINER_IMPORT_VERSION; type: typeof TRAINER_TYPE; title: string; description: string; skills: TrainerSkill[] };
export type GeneratedProblem = { prompt: string; answer: number; answerUnit: string; values: Record<string, number> };
export type TrainerPreview = { definition: TrainerDefinition; skillCount: number; variantCount: number; examples: Record<string, GeneratedProblem[]> };
export type TrainerImportResult = { ok: true; value: TrainerPreview } | { ok: false; errors: string[] };
export type TrainerSkillsPreview = { skills: TrainerSkill[]; skillCount: number; variantCount: number; examples: Record<string, GeneratedProblem[]> };
export type TrainerSkillsImportResult = { ok: true; value: TrainerSkillsPreview } | { ok: false; errors: string[] };

export function toClientSafeTrainerPreview(preview: TrainerPreview): TrainerPreview {
  return {
    definition: {
      version: preview.definition.version,
      type: preview.definition.type,
      title: preview.definition.title,
      description: preview.definition.description,
      skills: preview.definition.skills.map((skill) => ({
        key: skill.key,
        name: skill.name,
        formulaLatex: skill.formulaLatex,
        variants: skill.variants.map((variant) => ({
          key: variant.key,
          answerVariable: variant.answerVariable,
          answerUnit: variant.answerUnit,
          prompts: [...variant.prompts],
          variables: variant.variables.map((variable) => ({ ...variable })),
        })),
      })),
    },
    skillCount: preview.skillCount,
    variantCount: preview.variantCount,
    examples: Object.fromEntries(Object.entries(preview.examples).map(([key, problems]) => [key, problems.map((problem) => ({
      prompt: problem.prompt,
      answer: problem.answer,
      answerUnit: problem.answerUnit,
      values: Object.fromEntries(Object.entries(problem.values)),
    }))])),
  };
}

export function toClientSafeTrainerSkillsPreview(preview: TrainerSkillsPreview): TrainerSkillsPreview {
  const clientPreview = toClientSafeTrainerPreview({
    definition: { version: TRAINER_IMPORT_VERSION, type: TRAINER_TYPE, title: "Skills batch", description: "", skills: preview.skills },
    skillCount: preview.skillCount,
    variantCount: preview.variantCount,
    examples: preview.examples,
  });
  return { skills: clientPreview.definition.skills, skillCount: clientPreview.skillCount, variantCount: clientPreview.variantCount, examples: clientPreview.examples };
}

type Token = { kind: "number"; value: number } | { kind: "identifier"; value: string } | { kind: "operator"; value: string } | { kind: "eof" };
type Node = { kind: "number"; value: number } | { kind: "variable"; name: string } | { kind: "unary"; operator: "+" | "-"; child: Node } | { kind: "binary"; operator: "+" | "-" | "*" | "/" | "^"; left: Node; right: Node };
const safeKey = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (/[0-9]/.test(char)) {
      const start = index;
      while (/[0-9]/.test(source[index] ?? "")) index += 1;
      const raw = source.slice(start, index);
      const value = Number(raw);
      if (!Number.isSafeInteger(value)) throw new Error("целочисленный литерал выходит за безопасный диапазон");
      tokens.push({ kind: "number", value }); continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      while (/[A-Za-z0-9_]/.test(source[index] ?? "")) index += 1;
      tokens.push({ kind: "identifier", value: source.slice(start, index) }); continue;
    }
    if ("+-*/^()".includes(char)) { tokens.push({ kind: "operator", value: char }); index += 1; continue; }
    throw new Error(`недопустимый символ «${char}»`);
  }
  tokens.push({ kind: "eof" });
  return tokens;
}

function parseExpression(source: string, allowed: Set<string>): Node {
  const tokens = tokenize(source);
  let position = 0;
  const peek = () => tokens[position];
  const operatorValue = () => { const token = peek(); return token.kind === "operator" ? token.value : null; };
  const takeOperator = (operator: string) => operatorValue() === operator ? (position += 1, true) : false;
  const primary = (): Node => {
    const token = peek();
    if (token.kind === "number") { position += 1; return { kind: "number", value: token.value }; }
    if (token.kind === "identifier") {
      position += 1;
      if (!allowed.has(token.value)) throw new Error(`переменная «${token.value}» ещё не объявлена`);
      return { kind: "variable", name: token.value };
    }
    if (takeOperator("(")) {
      const node = sum();
      if (!takeOperator(")")) throw new Error("ожидалась закрывающая скобка");
      return node;
    }
    throw new Error("ожидалось число, переменная или скобка");
  };
  const unary = (): Node => takeOperator("+") ? { kind: "unary", operator: "+", child: unary() } : takeOperator("-") ? { kind: "unary", operator: "-", child: unary() } : primary();
  const power = (): Node => { const left = unary(); return takeOperator("^") ? { kind: "binary", operator: "^", left, right: power() } : left; };
  const product = (): Node => { let node = power(); while (operatorValue() === "*" || operatorValue() === "/") { const operator = operatorValue() as "*" | "/"; position += 1; node = { kind: "binary", operator, left: node, right: power() }; } return node; };
  const sum = (): Node => { let node = product(); while (operatorValue() === "+" || operatorValue() === "-") { const operator = operatorValue() as "+" | "-"; position += 1; node = { kind: "binary", operator, left: node, right: product() }; } return node; };
  if (!source.trim()) throw new Error("выражение пустое");
  const result = sum();
  if (peek().kind !== "eof") throw new Error("лишние символы после выражения");
  return result;
}

function checkedInteger(value: number): number {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || Math.abs(value) > TRAINER_LIMITS.integerAbs) throw new Error("результат не является целым числом безопасного диапазона");
  return value;
}

function evaluate(node: Node, values: Record<string, number>): number {
  if (node.kind === "number") return checkedInteger(node.value);
  if (node.kind === "variable") return checkedInteger(values[node.name]);
  if (node.kind === "unary") {
    const child = evaluate(node.child, values);
    return checkedInteger(node.operator === "-" ? -child : +child);
  }
  const left = evaluate(node.left, values), right = evaluate(node.right, values);
  if (node.operator === "/" && right === 0) throw new Error("деление на ноль");
  if (node.operator === "^" && (!Number.isInteger(right) || right < 0 || right > 12)) throw new Error("степень должна быть целой от 0 до 12");
  const result = node.operator === "+" ? left + right : node.operator === "-" ? left - right : node.operator === "*" ? left * right : node.operator === "/" ? left / right : left ** right;
  return checkedInteger(result);
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function exactKeys(value: Record<string, unknown>, expected: string[], path: string, errors: string[]) { for (const key of Object.keys(value)) if (!expected.includes(key)) errors.push(`${path}.${key}: неизвестное поле`); }
function stringField(value: unknown, path: string, min: number, max: number, errors: string[]) { if (typeof value !== "string") { errors.push(`${path}: ожидается строка`); return ""; } const normalized = value.trim(); if (normalized.length < min || normalized.length > max) errors.push(`${path}: длина после trim должна быть ${min}–${max}`); return normalized; }
function arrayField(value: unknown, path: string, min: number, max: number, errors: string[]) { if (!Array.isArray(value)) { errors.push(`${path}: ожидается массив`); return [] as unknown[]; } if (value.length < min || value.length > max) errors.push(`${path}: допустимо элементов ${min}–${max}`); return value; }

function compileVariant(variant: TrainerVariant) {
  const available = new Set<string>();
  const expressions = new Map<string, Node>();
  for (const variable of variant.variables) {
    if (variable.kind === "DERIVED") expressions.set(variable.name, parseExpression(variable.expression, available));
    available.add(variable.name);
  }
  return expressions;
}

function generateProblemWithAttempts(variant: TrainerVariant, random: () => number): { problem: GeneratedProblem; attempts: number } {
  const expressions = compileVariant(variant);
  for (let attempt = 0; attempt < TRAINER_LIMITS.generationRetries; attempt += 1) {
    const values: Record<string, number> = Object.create(null) as Record<string, number>;
    try {
      for (const variable of variant.variables) values[variable.name] = variable.kind === "RANDOM_INT" ? variable.min + Math.floor(random() * (variable.max - variable.min + 1)) : evaluate(expressions.get(variable.name)!, values);
      if (Object.values(values).some((value) => !Number.isInteger(value) || !Number.isFinite(value) || Math.abs(value) > TRAINER_LIMITS.integerAbs)) throw new Error("некорректная величина");
      const template = variant.prompts[Math.floor(random() * variant.prompts.length)];
      const prompt = template.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (_, name: string) => String(values[name]));
      return { problem: { prompt, answer: values[variant.answerVariable], answerUnit: variant.answerUnit, values: { ...values } }, attempts: attempt + 1 };
    } catch { /* reject the sample */ }
  }
  throw new Error(`не удалось получить целочисленную задачу за ${TRAINER_LIMITS.generationRetries} попыток`);
}

export function generateProblem(variant: TrainerVariant, random: () => number = Math.random): GeneratedProblem {
  return generateProblemWithAttempts(variant, random).problem;
}

function seededRandom(source: string): () => number {
  let seed = 2166136261;
  for (let index = 0; index < source.length; index += 1) seed = Math.imul(seed ^ source.charCodeAt(index), 16777619);
  return () => {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function parseTrainerImport(raw: string, previewCount = 3, rawBytesLimit = TRAINER_LIMITS.rawBytes): TrainerImportResult {
  const errors: string[] = [];
  if (Buffer.byteLength(raw, "utf8") > rawBytesLimit) return { ok: false, errors: [`root: JSON больше ${TRAINER_LIMITS.rawBytes / 1024} КБ`] };
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return { ok: false, errors: ["root: некорректный JSON"] }; }
  if (!isRecord(input)) return { ok: false, errors: ["root: ожидается JSON-объект"] };
  exactKeys(input, ["version", "type", "title", "description", "skills"], "root", errors);
  if (input.version !== TRAINER_IMPORT_VERSION) errors.push(`root.version: ожидается ${TRAINER_IMPORT_VERSION}`);
  if (input.type !== TRAINER_TYPE) errors.push(`root.type: ожидается ${TRAINER_TYPE}`);
  const title = stringField(input.title, "root.title", 1, TRAINER_LIMITS.title, errors);
  const description = input.description === undefined ? "" : stringField(input.description, "root.description", 0, TRAINER_LIMITS.description, errors);
  const skillsInput = arrayField(input.skills, "root.skills", 1, TRAINER_LIMITS.skills, errors);
  const skills: TrainerSkill[] = [];
  const skillKeys = new Set<string>();
  skillsInput.forEach((skillInput, skillIndex) => {
    const path = `skills[${skillIndex}]`;
    if (!isRecord(skillInput)) { errors.push(`${path}: ожидается объект`); return; }
    exactKeys(skillInput, ["key", "name", "formulaLatex", "variants"], path, errors);
    const key = stringField(skillInput.key, `${path}.key`, 1, 64, errors);
    if (!safeKey.test(key)) errors.push(`${path}.key: используйте латинские буквы, цифры и _; первый символ — буква или _`);
    if (skillKeys.has(key)) errors.push(`${path}.key: ключ «${key}» уже используется`); skillKeys.add(key);
    const name = stringField(skillInput.name, `${path}.name`, 1, TRAINER_LIMITS.skillName, errors);
    const formulaLatex = stringField(skillInput.formulaLatex, `${path}.formulaLatex`, 1, TRAINER_LIMITS.formulaLatex, errors);
    const variantsInput = arrayField(skillInput.variants, `${path}.variants`, 1, TRAINER_LIMITS.variantsPerSkill, errors);
    const variants: TrainerVariant[] = []; const variantKeys = new Set<string>();
    variantsInput.forEach((variantInput, variantIndex) => {
      const variantPath = `${path}.variants[${variantIndex}]`;
      if (!isRecord(variantInput)) { errors.push(`${variantPath}: ожидается объект`); return; }
      exactKeys(variantInput, ["key", "answerVariable", "answerUnit", "prompts", "variables"], variantPath, errors);
      const variantKey = stringField(variantInput.key, `${variantPath}.key`, 1, 64, errors);
      if (!safeKey.test(variantKey)) errors.push(`${variantPath}.key: небезопасный ключ`);
      if (variantKeys.has(variantKey)) errors.push(`${variantPath}.key: ключ «${variantKey}» уже используется`); variantKeys.add(variantKey);
      const answerVariable = stringField(variantInput.answerVariable, `${variantPath}.answerVariable`, 1, 64, errors);
      const answerUnit = stringField(variantInput.answerUnit, `${variantPath}.answerUnit`, 1, TRAINER_LIMITS.answerUnit, errors);
      const promptsInput = arrayField(variantInput.prompts, `${variantPath}.prompts`, 1, TRAINER_LIMITS.promptsPerVariant, errors);
      const variablesInput = arrayField(variantInput.variables, `${variantPath}.variables`, 1, TRAINER_LIMITS.variablesPerVariant, errors);
      const variables: TrainerVariable[] = []; const names = new Set<string>();
      variablesInput.forEach((variableInput, variableIndex) => {
        const variablePath = `${variantPath}.variables[${variableIndex}]`;
        if (!isRecord(variableInput)) { errors.push(`${variablePath}: ожидается объект`); return; }
        const kind = variableInput.kind;
        exactKeys(variableInput, kind === "RANDOM_INT" ? ["name", "kind", "min", "max"] : ["name", "kind", "expression"], variablePath, errors);
        const variableName = stringField(variableInput.name, `${variablePath}.name`, 1, 64, errors);
        if (!safeKey.test(variableName)) errors.push(`${variablePath}.name: небезопасное имя`);
        if (names.has(variableName)) errors.push(`${variablePath}.name: имя «${variableName}» уже используется`);
        if (kind === "RANDOM_INT") {
          const min = variableInput.min, max = variableInput.max;
          if (!Number.isInteger(min) || !Number.isInteger(max)) errors.push(`${variablePath}: min и max должны быть целыми`);
          else if (Math.abs(min as number) > TRAINER_LIMITS.integerAbs || Math.abs(max as number) > TRAINER_LIMITS.integerAbs) errors.push(`${variablePath}: границы выходят за ±${TRAINER_LIMITS.integerAbs}`);
          else if ((min as number) > (max as number)) errors.push(`${variablePath}: min не может быть больше max`);
          else variables.push({ name: variableName, kind, min: min as number, max: max as number });
        } else if (kind === "DERIVED") {
          const expression = stringField(variableInput.expression, `${variablePath}.expression`, 1, TRAINER_LIMITS.expression, errors);
          try { parseExpression(expression, names); } catch (error) { errors.push(`${variablePath}.expression: ${error instanceof Error ? error.message : "некорректное выражение"}`); }
          variables.push({ name: variableName, kind, expression });
        } else errors.push(`${variablePath}.kind: ожидается RANDOM_INT или DERIVED`);
        names.add(variableName);
      });
      if (!names.has(answerVariable)) errors.push(`${variantPath}.answerVariable: переменная «${answerVariable}» не объявлена`);
      const prompts = promptsInput.map((promptInput, promptIndex) => {
        const promptPath = `${variantPath}.prompts[${promptIndex}]`; const prompt = stringField(promptInput, promptPath, 1, TRAINER_LIMITS.promptLength, errors);
        const stripped = prompt.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (_, variableName: string) => { if (!names.has(variableName)) errors.push(`${promptPath}: неизвестная переменная «${variableName}»`); if (variableName === answerVariable) errors.push(`${promptPath}: ответ «${answerVariable}» нельзя показывать в условии`); return ""; });
        if (stripped.includes("{{") || stripped.includes("}}")) errors.push(`${promptPath}: placeholder должен иметь вид {{variableName}}`);
        return prompt;
      });
      variants.push({ key: variantKey, answerVariable, answerUnit, prompts, variables });
    });
    skills.push({ key, name, formulaLatex, variants });
  });
  if (errors.length) return { ok: false, errors: errors.slice(0, 100) };
  const definition: TrainerDefinition = { version: TRAINER_IMPORT_VERSION, type: TRAINER_TYPE, title, description, skills };
  const examples: Record<string, GeneratedProblem[]> = Object.create(null) as Record<string, GeneratedProblem[]>;
  for (const skill of skills) for (const variant of skill.variants) {
    const path = `${skill.key}.${variant.key}`;
    try {
      const validationRandom = seededRandom(JSON.stringify(variant));
      const attempts: number[] = [];
      for (let sample = 0; sample < TRAINER_LIMITS.validationSamples; sample += 1) attempts.push(generateProblemWithAttempts(variant, validationRandom).attempts);
      const maximumAttempts = Math.max(...attempts);
      const averageAttempts = attempts.reduce((sum, attempt) => sum + attempt, 0) / attempts.length;
      if (maximumAttempts > TRAINER_LIMITS.validationMaxAttempts || averageAttempts > TRAINER_LIMITS.validationAverageAttempts) {
        throw new Error(`числовой generator слишком часто создаёт недопустимые или дробные значения (максимум ${maximumAttempts} попыток, среднее ${averageAttempts.toFixed(2)}); измените диапазоны или выражения шаблона`);
      }
      examples[path] = Array.from({ length: Math.max(0, Math.min(previewCount, 5)) }, () => generateProblem(variant));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "ошибка генерации";
      errors.push(`skills.${skill.key}.variants.${variant.key}: ${reason.includes("числовой generator") ? reason : `числовой generator не смог стабильно создать целые значения: ${reason}; измените диапазоны или выражения шаблона`}`);
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { definition, skillCount: skills.length, variantCount: skills.reduce((sum, skill) => sum + skill.variants.length, 0), examples } };
}

export function parseTrainerSkillsImport(raw: string, previewCount = 3): TrainerSkillsImportResult {
  if (Buffer.byteLength(raw, "utf8") > TRAINER_LIMITS.rawBytes) return { ok: false, errors: [`root: JSON больше ${TRAINER_LIMITS.rawBytes / 1024} КБ`] };
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return { ok: false, errors: ["root: некорректный JSON"] }; }
  if (!isRecord(input)) return { ok: false, errors: ["root: ожидается JSON-объект"] };
  const errors: string[] = [];
  exactKeys(input, ["version", "skills"], "root", errors);
  if (input.version !== TRAINER_SKILLS_IMPORT_VERSION) errors.push(`root.version: ожидается ${TRAINER_SKILLS_IMPORT_VERSION}`);
  if (!Array.isArray(input.skills)) errors.push("root.skills: ожидается массив");
  if (errors.length) return { ok: false, errors };
  const wrapped = JSON.stringify({ version: TRAINER_IMPORT_VERSION, type: TRAINER_TYPE, title: "Skills batch", description: "", skills: input.skills });
  const parsed = parseTrainerImport(wrapped, previewCount, TRAINER_LIMITS.rawBytes + 1_024);
  if (!parsed.ok) return parsed;
  return { ok: true, value: { skills: parsed.value.definition.skills, skillCount: parsed.value.skillCount, variantCount: parsed.value.variantCount, examples: parsed.value.examples } };
}
