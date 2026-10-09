import {
  R, add, sub, mul, div, canonical, displayDecimal, ri, pick, shuffle,
  type Rat, type GeneratedSection1Task, type Template,
} from "./section1-generator-core";
import type { SkillAnswerKind } from "./skill-answer-policy";

const D = (r: Rat, scale = 0) => displayDecimal(r, scale);
const F = (r: Rat) => r.d === BigInt(1) ? String(r.n) : `\\frac{${r.n}}{${r.d}}`;
const M = (expr: string) => `$${expr.replace(/(\d),(\d)/g, "$1{,}$2")}$`;
const hints: Record<SkillAnswerKind, string> = {
  integer: "Введите целое число.",
  decimal: "Введите десятичную дробь с запятой или точкой. Обыкновенная дробь не принимается.",
  fraction: "Введите несократимую обыкновенную дробь a/b. Десятичная запись не принимается.",
  mixed: "Введите целую часть, числитель и знаменатель. Дробная часть должна быть правильной и несократимой.",
  number: "Введите точный ответ: целое число, десятичную или обыкновенную дробь a/b.",
  sequence: "Введите все числа в указанном порядке, разделяя их точкой с запятой: 1; 2; 3.",
  inequality: "Введите двойное неравенство от меньшего числа к большему: 1 < 2 < 3.",
  power: "Введите степень в формате a^n, например 3^4. Значение степени не принимается.",
};
type Extra = Record<string, string | number | boolean>;
function Q(prompt: string, answer: Rat | string, kind: SkillAnswerKind = "integer", extra: Extra = {}): GeneratedSection1Task {
  const value = typeof answer === "string" ? answer : canonical(answer);
  let display = value;
  if (typeof answer !== "string") {
    if (kind === "decimal") display = D(answer, typeof extra.decimal_places === "number" ? extra.decimal_places : 0);
    if (kind === "mixed") display = `${answer.n / answer.d} ${answer.n % answer.d}/${answer.d}`;
  }
  return {
    prompt, expectedAnswer: value, difficulty: "CORE",
    parameters: { answer_policy_version: 2, answer_kind: kind, answer_hint: hints[kind],
      require_reduced: kind === "fraction" || kind === "mixed", answer_display: display, ...extra },
  };
}
const I = (expr: string, answer: number, extra: Extra = {}) => Q(`Вычислите ${M(expr)}.`, R(answer), "integer", extra);
const A = () => ri(2, 25);
const fraction = () => { const d = ri(3, 12); return R(ri(1, d - 1), d); };
const decimal = () => R(ri(1, 999), 100);
const compare = (a: Rat, b: Rat) => a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;

/** Each entry is a mandatory subtype; every attempt includes every entry once. */
const skills: Record<number, (() => GeneratedSection1Task)[]> = {
  1: [
    ...["+", "-", "\\cdot", "\\div"].map(op => () => { const a = ri(30, 900), b = A(); return I(`${op === "\\div" ? a * b : a}${op}${b}`, op === "+" ? a + b : op === "-" ? a - b : op === "\\cdot" ? a * b : a); }),
    ...["+", "-", "\\cdot", "\\div"].map(op => () => { const a = -A(), b = -A(); return I(`${op === "\\div" ? a * b : a}${op}(${b})`, op === "+" ? a + b : op === "-" ? a - b : op === "\\cdot" ? a * b : a); }),
    ...["+", "-", "\\cdot", "\\div"].map(op => () => { const a = fraction(), b = fraction(); return Q(`Вычислите ${M(`${F(a)}${op}${F(b)}`)}.`, op === "+" ? add(a, b) : op === "-" ? sub(a, b) : op === "\\cdot" ? mul(a, b) : div(a, b), "number"); }),
    ...["+", "-", "\\cdot", "\\div"].map(op => () => { const a = R(A()), b = fraction(); return Q(`Вычислите ${M(`${F(a)}${op}${F(b)}`)}.`, op === "+" ? add(a, b) : op === "-" ? sub(a, b) : op === "\\cdot" ? mul(a, b) : div(a, b), "number"); }),
    ...["+", "-", "\\cdot", "\\div"].map(op => () => { const a = A(), x = A(); const rhs = op === "+" ? a + x : op === "-" ? a : op === "\\cdot" ? a * x : a; return Q(`Найдите ${M("x")}: ${M(`${op === "-" || op === "\\div" ? (op === "-" ? a + x : a * x) : a}${op} x=${rhs}`)}.`, R(x)); }),
  ],
  2: [
    () => { const a = A(), b = A(); return I(`-${a}+${b}`, b - a); },
    () => { const a = -A(), b = A(); return I(`${a}-(-${b})`, a + b); },
    () => { const a = -A(), b = A(); return I(`${a}\\cdot${b}`, a * b); },
    () => { const a = -A(), b = A(); return I(`${a * b}\\div${b}`, a); },
    () => { const a = -A(), b = -A(), c = -A(); return I(`${a}+(${b})-(${c})`, a + b - c); },
    () => { const a = -A(), b = -A(); return I(`${a}\\cdot(${b})`, a * b); },
    () => { const a = A(), b = -A(); return I(`${a * b}\\div(${b})`, a); },
  ],
  3: [
    () => { const a = A(); return I(`|${a}|`, a); },
    () => { const a = -A(); return I(`|${a}|`, -a); },
    () => { const a = A(); return Q(`Найдите число, противоположное ${M(String(a))}.`, R(-a)); },
    () => { const a = -A(); return Q(`Найдите число, противоположное ${M(String(a))}.`, R(-a)); },
    () => { const a = -A(), b = A(), c = -A(); return I(`|${a}|-|${b}|+|${c}|`, -a - b - c); },
    () => { const a = -A(); return I(`-|${a}|`, a); },
  ],
  4: [
    () => { const a = -A(), b = A(); return Q(`Какое число больше: ${M(String(a))} или ${M(String(b))}?`, R(b)); },
    () => { const a = R(ri(100, 199), 100), b = R(ri(200, 299), 100); return Q(`Какое число меньше: ${M(D(b))} или ${M(D(a))}? Запишите десятичной дробью.`, a, "decimal"); },
    () => { const a = fraction(); let b = fraction(); while (compare(a, b) === 0) b = fraction(); return Q(`Какая дробь больше: ${M(F(a))} или ${M(F(b))}? Запишите несократимой дробью.`, compare(a, b) > 0 ? a : b, "fraction"); },
    () => { const values = [R(-A()), fraction(), R(A()), R(-ri(1, 9), 10)]; return Q(`Расположите по возрастанию: ${M(shuffle([...values]).map(F).join(";\\;"))}.`, [...values].sort(compare).map(canonical).join(";"), "sequence"); },
    () => { const l = -A(), r = A(), x = ri(l + 1, r - 1); return Q(`Какое из чисел ${M(`${r + 1};\\;${x};\\;${l - 1}`)} удовлетворяет ${M(`${l}<x<${r}`)}?`, R(x)); },
    () => { const a = -A(), b = ri(0, 10), c = b + A(); return Q(`Объедините ${M(`${b}>${a}`)} и ${M(`${b}<${c}`)} в двойное неравенство, начиная с меньшего числа.`, `${a}<${b}<${c}`, "inequality"); },
    () => { const l = ri(-12, 5), r = l + ri(3, 6); return Q(`Запишите по возрастанию все целые числа, для которых ${M(`${l}<x<${r}`)}.`, Array.from({ length: r - l - 1 }, (_, i) => String(l + i + 1)).join(";"), "sequence"); },
    () => { const x = ri(-10, 10); return Q(`Найдите единственное целое число ${M("x")}, для которого ${M(`${D(R(x * 10 - 3, 10))}<x<${D(R(x * 10 + 7, 10))}`)}.`, R(x)); },
  ],
  5: [
    () => { const a = A(), b = A(), c = A(), q = A(), d = A(); return I(`${a}+${b}\\cdot${c}-${q * d}\\div${d}`, a + b * c - q); },
    () => { const a = A(), b = A(), c = A(), d = A(); return I(`${a}\\cdot[${b}+(${c}-${d})]`, a * (b + c - d)); },
    () => { const a = A(), b = A(), c = A(); return I(`${a * b}\\div${b}\\cdot${c}`, a * c); },
    () => { const a = A(), b = A(), c = A(); return I(`${a * b * c}\\div${b}\\div${c}`, a); },
    () => { const a = ri(2, 9), b = A(), c = A(), d = ri(2, 9); return I(`(${a}^2+${b})-(${c}-${d}^2)`, a * a + b - c + d * d); },
  ],
  6: [
    () => { const a = ri(11, 89), b = A(); return I(`${a}+${b}+${100 - a}`, 100 + b); },
    () => { const a = ri(21, 79), b = A(); return I(`${a}+${100 - a}+(${b}+${200 - b})`, 300); },
    () => { const [a, b] = pick([[25, 4], [125, 8], [50, 2]]), c = A(); return I(`${a}\\cdot${c}\\cdot${b}`, a * b * c); },
    () => { const a = A(), b = ri(2, 19); return I(`${a}\\cdot(${b}+${20 - b})`, a * 20); },
    ...[10, 100, 1000].map(base => () => { const a = A(), delta = pick([-1, 1]); return I(`${base + delta}\\cdot${a}`, (base + delta) * a); }),
    () => { const a = A(), b = ri(2, 98); return I(`${b}\\cdot${a}+${100 - b}\\cdot${a}`, 100 * a); },
  ],
  7: [
    ...[2, 3, 4].map(e => () => { const a = ri(2, e === 2 ? 20 : 6); return I(`${a}^{${e}}`, a ** e); }),
    () => { const a = ri(2, 9), e = ri(3, 6); return Q(`Запишите произведение в виде степени с основанием ${M(String(a))}: ${M(Array(e).fill(a).join("\\cdot"))}.`, `${a}^${e}`, "power"); },
    () => { const a = ri(2, 12), e = pick([2, 3]); return Q(`Найдите натуральное ${M("x")}: ${M(`x^{${e}}=${a ** e}`)}.`, R(a)); },
    () => { const a = ri(2, 5), e = ri(2, 6); return Q(`Найдите натуральное ${M("n")}: ${M(`${a}^n=${a ** e}`)}.`, R(e)); },
    () => { const a = ri(2, 7), b = ri(2, 7), c = ri(2, 7); return I(`${a}^2+${b}\\cdot${c}^3`, a * a + b * c ** 3); },
    () => { const e = ri(2, 6); return I(`10^{${e}}`, 10 ** e); },
  ],
  8: [
    ...[1, 2, 3].map(scale => () => { const w = ri(0, 25), n = ri(1, 10 ** scale - 1); return Q(`Запишите десятичной дробью: ${M(String(w))} целых ${M(String(n))} ${["", "десятых", "сотых", "тысячных"][scale]}.`, R(w * 10 ** scale + n, 10 ** scale), "decimal"); }),
    () => { const digits = [ri(1, 9), ri(1, 9), ri(1, 9)], pos = ri(0, 2), w = A(); return Q(`Какая цифра стоит в разряде ${["десятых", "сотых", "тысячных"][pos]} числа ${M(`${w},${digits.join("")}`)}?`, R(digits[pos])); },
    () => { const digits = [ri(1, 9), ri(1, 9), ri(1, 9)], pos = ri(0, 2), w = A(); return Q(`Чему равно разрядное значение цифры в разряде ${["десятых", "сотых", "тысячных"][pos]} числа ${M(`${w},${digits.join("")}`)}? Запишите десятичной дробью.`, R(digits[pos], 10 ** (pos + 1)), "decimal"); },
    () => { const w = A(), a = R(w * 100 + 40, 100), b = R(w * 100 + ri(41, 49), 100); return Q(`Какое число больше: ${M(D(a, 3))} или ${M(D(b, 2))}? Запишите десятичной дробью.`, b, "decimal"); },
    () => { const w = A(), values = [R(w * 1000 + 501, 1000), R(w * 100 + 50, 100), R(w * 1000 + 510, 1000)]; return Q(`Расположите по возрастанию: ${M(shuffle([...values]).map(x => D(x)).join(";\\;"))}.`, [...values].sort(compare).map(canonical).join(";"), "sequence"); },
    () => { const r = R(ri(1, 999), 100); return Q(`Уберите лишние нули в конце числа ${M(D(r, 4))}. Запишите десятичной записью.`, r, "decimal", { no_trailing_zeros: true }); },
    () => { const w = A(), a = ri(1, 9), b = ri(1, 9), c = ri(1, 9); return Q(`Запишите десятичной дробью: ${M(`${w}+\\frac{${a}}{10}+\\frac{${b}}{100}+\\frac{${c}}{1000}`)}.`, R(w * 1000 + a * 100 + b * 10 + c, 1000), "decimal"); },
  ],
  9: [
    ...["+", "-", "\\cdot", "\\div"].map(op => () => { const a = R(ri(1, 99) * 10 + ri(1, 9), 100), b = R(ri(1, 99) * 10 + ri(1, 9), 10); const lhs = op === "\\div" ? mul(a, b) : a; return Q(`Вычислите ${M(`${D(lhs)}${op}${D(b, 1)}`)}. Запишите десятичной дробью.`, op === "+" ? add(a, b) : op === "-" ? sub(a, b) : op === "\\cdot" ? mul(a, b) : a, "decimal"); }),
    () => { const a = decimal(), b = A(); return Q(`Вычислите ${M(`${D(a)}\\cdot${b}`)}. Запишите десятичной дробью.`, mul(a, R(b)), "decimal"); },
    () => { const a = decimal(), b = A(); return Q(`Вычислите ${M(`${D(mul(a, R(b)))}\\div${b}`)}. Запишите десятичной дробью.`, a, "decimal"); },
    () => { const a = decimal(), x = R(ri(1, 99), 10); return Q(`Найдите множитель ${M("x")}: ${M(`${D(a)}\\cdot x=${D(mul(a, x))}`)}. Запишите десятичной дробью.`, x, "decimal"); },
    () => { const a = decimal(), x = R(ri(1, 99), 10); return Q(`Найдите делитель ${M("x")}: ${M(`${D(mul(a, x))}\\div x=${D(a)}`)}. Запишите десятичной дробью.`, x, "decimal"); },
  ],
  10: [
    () => { const d = pick([2, 4, 5, 8, 20, 25]), r = R(ri(1, d - 1), d); return Q(`Переведите ${M(F(r))} в конечную десятичную дробь.`, r, "decimal"); },
    () => { const d = pick([2, 4, 5, 8, 20]), n = ri(1, d - 1), k = ri(2, 8); return Q(`Сократите и переведите ${M(`\\frac{${n * k}}{${d * k}}`)} в конечную десятичную дробь.`, R(n, d), "decimal"); },
    () => { const d = pick([2, 4, 5, 8, 20]), r = R(ri(2, 9) * d + ri(1, d - 1), d); return Q(`Переведите ${M(F(r))} в конечную десятичную дробь.`, r, "decimal"); },
    () => { const w = ri(1, 9), d = pick([2, 4, 5, 8, 20]), f = R(ri(1, d - 1), d); return Q(`Переведите ${M(`${w}${F(f)}`)} в конечную десятичную дробь.`, add(R(w), f), "decimal"); },
    () => { const r = R(ri(1, 99), 100); return Q(`Переведите ${M(D(r, 2))} в несократимую обыкновенную дробь.`, r, "fraction"); },
    () => { const r = R(ri(1, 999), 1000); return Q(`Переведите ${M(D(r, 3))} в несократимую обыкновенную дробь.`, r, "fraction"); },
    () => { const w = ri(1, 9), f = R(ri(1, 99), 100), r = add(R(w), f); return Q(`Переведите ${M(D(r, 2))} в смешанное число с несократимой дробной частью.`, r, "mixed"); },
  ],
  11: [
    ...[1, 2, 3].map(length => () => { let p = ri(10 ** (length - 1), 10 ** length - 2); while (length > 1 && /^(.)\1+$/.test(String(p))) p = ri(10 ** (length - 1), 10 ** length - 2); return Q(`Переведите ${M(`0{,}\\overline{${p}}`)} в несократимую обыкновенную дробь.`, R(p, 10 ** length - 1), "fraction"); }),
    ...[1, 2].map(length => () => { const nr = ri(0, 10 ** length - 1), p = ri(1, 8); return Q(`Переведите ${M(`0{,}${String(nr).padStart(length, "0")}\\overline{${p}}`)} в несократимую обыкновенную дробь.`, R(nr * 9 + p, 10 ** length * 9), "fraction"); }),
    () => { const w = ri(1, 8), p = ri(10, 98); return Q(`Переведите ${M(`${w}{,}\\overline{${p}}`)} в несократимую обыкновенную дробь.`, R(w * 99 + p, 99), "fraction"); },
    () => { const w = ri(1, 8), nr = ri(0, 9), p = ri(10, 98); return Q(`Переведите ${M(`${w}{,}${nr}\\overline{${p}}`)} в несократимую обыкновенную дробь.`, R(w * 990 + nr * 99 + p, 990), "fraction"); },
  ],
  12: [
    ...[1, 2, 3].flatMap(scale => [false, true].flatMap(small => [false, true].map(divide => () => { const a = decimal(), b = small ? R(1, 10 ** scale) : R(10 ** scale), result = divide ? div(a, b) : mul(a, b); return Q(`Вычислите без округления ${M(`${D(a)}${divide ? "\\div" : "\\cdot"}${D(b)}`)}. Запишите десятичной дробью.`, result, "decimal"); }))),
    () => { const a = decimal(), x = R(10 ** ri(1, 3)); return Q(`Найдите множитель ${M("x")}: ${M(`${D(a)}\\cdot x=${D(mul(a, x))}`)}.`, x); },
    () => { const a = decimal(), x = R(1, 10 ** ri(1, 3)); return Q(`Найдите делитель ${M("x")}: ${M(`${D(mul(a, x))}\\div x=${D(a)}`)}. Запишите десятичной дробью.`, x, "decimal"); },
  ],
  13: [
    ...[1, 2, 3].map(scale => () => { const p = 10 ** scale, n = ri(1000, 999999); return Q(`Округлите ${M(String(n))} до ${["", "десятков", "сотен", "тысяч"][scale]}.`, R(Math.floor((n + p / 2) / p) * p)); }),
    ...[0, 1, 2].map(scale => () => { const n = ri(1, 99999), factor = 10 ** scale; return Q(`Округлите ${M(D(R(n, factor * 10), scale + 1))} до ${["целых", "десятых", "сотых"][scale]}.`, R(Math.floor((n + 5) / 10), factor), scale === 0 ? "integer" : "decimal", scale === 0 ? {} : { decimal_places: scale }); }),
    () => { const n = ri(1, 999); return Q(`Округлите ${M(D(R(n * 10 + 5, 100), 2))} до десятых.`, R(n + 1, 10), "decimal", { decimal_places: 1 }); },
    () => { const w = A(); return Q(`Округлите ${M(`${w}{,}995`)} до сотых.`, R(w + 1), "decimal", { decimal_places: 2 }); },
  ],
  14: [
    () => { const a = A(), b = fraction(), c = decimal(); return Q(`Вычислите ${M(`${a}+${F(b)}-${D(c)}`)}.`, sub(add(R(a), b), c), "number"); },
    () => { const a = decimal(), b = R(1, pick([3, 7, 9, 11])), c = A(); return Q(`Вычислите ${M(`(${D(a)}+${F(b)})\\cdot${c}`)}.`, mul(add(a, b), R(c)), "number"); },
    () => { const a = A(), b = fraction(), c = R(ri(1, 9), 10); return Q(`Вычислите ${M(`(${a}-${F(b)})\\div${D(c)}`)}.`, div(sub(R(a), b), c), "number"); },
    () => { const a = -ri(10, 25), b = fraction(), c = R(ri(1, 9), 10), d = ri(2, 9); return Q(`Вычислите ${M(`${a}+${F(b)}+${D(c)}\\cdot${d}`)}.`, add(add(R(a), b), mul(c, R(d))), "number"); },
    () => { const w = A(), a = R(1, 2), b = R(pick([1, 2, 3, 4, 6, 7, 8, 9]), 10); return Q(`Вычислите ${M(`${w}${F(a)}+${D(b)}`)} и запишите смешанным числом с несократимой дробной частью.`, add(add(R(w), a), b), "mixed"); },
  ],
};

export const NIS_NEW_TEMPLATE_COUNTS = Object.fromEntries(Object.entries(skills).map(([i, list]) => [i, list.length]));
export function isNisNewGenerator(key: string) { return /^nis_new_s1_(?:[1-9]|1[0-4])_v2$/.test(key); }
export function nisNewTemplates(skill: number): Template[] {
  if (!skills[skill]) throw new Error("Unknown NIS skill");
  return skills[skill].map((make, i) => ({ id: `nis-new-1.${skill}-${i + 1}`, difficulty: "CORE", make: () => {
    const t = make();
    const difficulty = i === 0 ? "BASIC" : i === skills[skill].length - 1 ? "CHALLENGE" : "CORE";
    return { ...t, difficulty, parameters: { ...t.parameters, template: `nis-new-1.${skill}-${i + 1}` } };
  } }));
}
export function generateNisNewTasks(key: string): GeneratedSection1Task[] {
  if (!isNisNewGenerator(key)) throw new Error("Unknown NIS new generator");
  const templates = nisNewTemplates(Number(key.split("_")[3]));
  const chosen = [...templates];
  while (chosen.length < 10) chosen.push(pick(templates));
  const prompts = new Set<string>();
  return shuffle(chosen.map(t => {
    for (let i = 0; i < 100; i++) {
      const candidate = t.make();
      if (!prompts.has(candidate.prompt)) { prompts.add(candidate.prompt); return candidate; }
    }
    throw new Error(`Cannot generate unique ${t.id}`);
  }));
}
