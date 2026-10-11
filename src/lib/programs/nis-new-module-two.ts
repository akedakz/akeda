import { ri, pick, shuffle, type GeneratedSection1Task } from "./section1-generator-core";
import type { SkillAnswerKind } from "./skill-answer-policy";

const M = (s: string | number) => `$${s}$`;
const primes = [2, 3, 5, 7, 11, 13, 17, 19];
const range = (l: number, h: number) => Array.from({ length: h - l + 1 }, (_, i) => l + i);
const list = (items: number[]) => items.join(";");
const latexList = (items: number[]) => M(items.join(";\\;"));
const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
const lcm = (a: number, b: number) => a / gcd(a, b) * b;
const divisors = (n: number) => range(1, n).filter(d => n % d === 0);
function factorization(n: number) {
  const result: [number, number][] = [];
  for (let d = 2; d * d <= n; d++) if (n % d === 0) {
    let e = 0; while (n % d === 0) { n /= d; e++; } result.push([d, e]);
  }
  if (n > 1) result.push([n, 1]);
  return result;
}
const factorLatex = (n: number) => factorization(n).map(([p, e]) => `${p}^{${e}}`).join("\\cdot ");
const factorInput = (n: number) => factorization(n).map(([p, e]) => `${p}^${e}`).join(" * ");
function modPower(a: number, e: number, m = 10) {
  let out = 1; a %= m;
  while (e) { if (e % 2) out = out * a % m; a = a * a % m; e = Math.floor(e / 2); }
  return out;
}
type Check = { op: string; args: number[]; mode?: string };
type Kind = Extract<SkillAnswerKind, "integer" | "integer_list" | "factorization">;
function Q(prompt: string, answer: number | string, check: Check, kind: Kind = "integer", hint?: string): GeneratedSection1Task {
  return { prompt, expectedAnswer: String(answer), difficulty: "CORE", parameters: {
    answer_policy_version: 2, answer_kind: kind, answer_display: kind === "factorization" ? factorInput(Number(answer)) : String(answer),
    answer_hint: hint ?? (kind === "integer_list" ? "Введите все целые числа по возрастанию через ;. Если число одно, введите только его." : kind === "factorization" ? "Введите только простые множители: 2^3 * 3 или 2*2*2*3. Порядок множителей неважен. Само число не заменяет разложение." : "Введите целое число. Десятичная запись и дробь не принимаются."),
    check_case: JSON.stringify(check),
  } };
}
const yes = (prompt: string, answer: boolean, check: Check) => Q(`${prompt} Введите ${M(1)}, если да, и ${M(0)}, если нет.`, Number(answer), check);
const choose = (values: number[], mode: string): number | string => mode === "count" ? values.length : mode === "min" ? values[0] : mode === "max" ? values.at(-1)! : list(values);

function residueTask(two: boolean, mode: string, narrow = false) {
  const a = ri(3, 9), b = pick(primes.filter(p => p !== a && gcd(a, p) === 1 && p <= 11));
  const target = ri(30, 150), period = two ? a * b : a;
  const l = narrow ? Math.max(1, target - ri(0, Math.floor((period - 1) / 2))) : ri(1, 25);
  const h = narrow ? l + period - 1 : l + period * ri(2, 4);
  const r1 = target % a, r2 = target % b;
  const values = range(l, h).filter(n => n % a === r1 && (!two || n % b === r2));
  const requirement = mode === "count" ? "Сколько существует" : mode === "min" ? "Найдите наименьшее" : mode === "max" ? "Найдите наибольшее" : "Запишите все";
  return Q(`${requirement} ${mode === "count" ? "натуральных чисел" : mode === "all" ? "натуральные числа (по возрастанию)" : "натуральное число"} от ${M(l)} до ${M(h)} включительно, ${mode === "all" || mode === "count" ? "которые" : "которое"} при делении на ${M(a)} ${mode === "all" || mode === "count" ? "дают" : "даёт"} остаток ${M(r1)}${two ? `, а при делении на ${M(b)} — остаток ${M(r2)}` : ""}.`, choose(values, mode), { op: "residues", args: [l, h, a, r1, two ? b : 1, two ? r2 : 0], mode }, mode === "all" ? "integer_list" : "integer");
}
function digitTask(ds: number[], mode = "all", leading = false) {
  // Enumerate the full digit domain, so all answers, counts and extrema agree.
  for (let tries = 0; tries < 100; tries++) {
    const prefix = ri(10, 98), suffix = pick(range(0, 9).filter(d => ds.every(k => ![2, 5, 10].includes(k) || d % k === 0)));
    const pattern = leading ? `x${prefix}${suffix}` : `${prefix}x${suffix}`;
    const values = range(leading ? 1 : 0, 9).filter(d => ds.every(k => Number(pattern.replace("x", String(d))) % k === 0));
    if (!values.length) continue;
    const action = mode === "count" ? "Сколько цифр можно поставить" : mode === "min" ? "Какую наименьшую цифру можно поставить" : mode === "max" ? "Какую наибольшую цифру можно поставить" : "Какие цифры можно поставить";
    return Q(`${action} вместо ${M("x")} в числе ${M(`\\overline{${pattern}}`)}, чтобы оно делилось на ${ds.map(M).join(" и ")}?${leading ? " Первая цифра не может быть нулём." : " Цифра может быть нулём."}`, choose(values, mode), { op: "digits", args: [prefix, suffix, Number(leading), ...ds], mode }, mode === "all" ? "integer_list" : "integer");
  }
  throw new Error("Cannot construct a solvable missing-digit task");
}

const skills: Record<number, (() => GeneratedSection1Task)[]> = {
  1: [
    () => { const n = ri(12, 150); return Q(`Запишите все натуральные делители числа ${M(n)} по возрастанию.`, list(divisors(n)), { op: "divisors", args: [n] }, "integer_list"); },
    () => { const d = ri(3, 15), l = ri(1, 40), h = l + d * ri(3, 6); return Q(`Запишите все кратные ${M(d)} от ${M(l)} до ${M(h)} включительно.`, list(range(l, h).filter(n => n % d === 0)), { op: "multiples", args: [d, l, h] }, "integer_list"); },
    ...[false, true].map(divisible => () => { const d = ri(3, 20), n = d * ri(5, 40) + (divisible ? 0 : ri(1, d - 1)); return yes(`Делится ли ${M(n)} на ${M(d)} без остатка?`, divisible, { op: "divisible", args: [n, d] }); }),
    () => { const d = ri(3, 12), l = ri(1, 60), h = l + ri(20, 100); return Q(`Сколько натуральных чисел от ${M(l)} до ${M(h)} включительно кратны ${M(d)}?`, Math.floor(h / d) - Math.floor((l - 1) / d), { op: "multiples", args: [d, l, h], mode: "count" }); },
    () => { const a = ri(3, 15), b = ri(3, 15); return Q(`Найдите наименьшее натуральное число, среди делителей которого есть ${M(a)} и ${M(b)}.`, lcm(a, b), { op: "lcm", args: [a, b] }); },
  ],
  2: [
    () => { const p = pick(primes), c = p * ri(2, 12); return Q(`Какое из чисел ${latexList([1, p, c])} не является ни простым, ни составным?`, 1, { op: "neither", args: [1, p, c] }); },
    () => { const p = pick(primes.slice(1)), n = p * ri(2, 12); return yes(`Является ли ${M(n)} простым числом?`, false, { op: "prime", args: [n] }); },
    () => { const p = pick(primes); return yes(`Является ли ${M(p)} простым числом?`, true, { op: "prime", args: [p] }); },
    () => { const n = ri(20, 250); return Q(`Запишите все различные простые делители числа ${M(n)} по возрастанию.`, list(factorization(n).map(([p]) => p)), { op: "prime_divisors", args: [n] }, "integer_list"); },
    () => { const n = 2 ** ri(1, 5) * 3 ** ri(1, 3) * pick([1, 5, 7]); return Q(`Разложите ${M(n)} на простые множители полностью.`, n, { op: "factorization", args: [n] }, "factorization"); },
    () => { const n = 2 ** ri(1, 4) * 5 ** ri(1, 3); return Q(`Восстановите число по разложению ${M(factorLatex(n))}.`, n, { op: "product_powers", args: factorization(n).flat() }); },
    () => { const p = pick(primes), a = ri(1, 4), b = ri(1, 3), n = 2 ** a * 3 ** b * p; return Q(`Найдите недостающий простой множитель ${M("p")}: ${M(`${n}=2^{${a}}\\cdot3^{${b}}\\cdot p`)}.`, p, { op: "missing_factor", args: [n, 2 ** a * 3 ** b] }); },
    () => { const n = pick(primes) ** ri(2, 5); return Q(`Разложите ${M(n)} на простые множители.`, n, { op: "factorization", args: [n] }, "factorization"); },
  ],
  3: [
    ...range(2, 10).map(d => () => { const divisible = pick([false, true]), n = d * ri(50, 900) + (divisible ? 0 : ri(1, d - 1)); return yes(`Используя признак делимости, определите: делится ли ${M(n)} на ${M(d)} без остатка?`, divisible, { op: "divisible", args: [n, d] }); }),
    () => { const a = ri(2, 5), b = ri(6, 10), period = lcm(a, b), n = period * ri(10, 100) + pick([0, ri(1, period - 1)]); return yes(`Делится ли ${M(n)} одновременно на ${M(a)} и ${M(b)}?`, n % a === 0 && n % b === 0, { op: "divisible_all", args: [n, a, b] }); },
    () => { const d = ri(2, 10), l = ri(100, 300), h = l + 30; return Q(`Используя признак делимости, запишите по возрастанию все числа от ${M(l)} до ${M(h)} включительно, которые делятся на ${M(d)}.`, list(range(l, h).filter(n => n % d === 0)), { op: "multiples", args: [d, l, h] }, "integer_list"); },
  ],
  4: [
    () => { const a = ri(12, 150), b = ri(12, 150); return Q(`Найдите ${M(`\\gcd(${a},${b})`)} — наибольший общий делитель.`, gcd(a, b), { op: "gcd", args: [a, b] }); },
    () => { const g = ri(2, 15), a = g * ri(2, 12), b = g * ri(2, 12), c = g * ri(2, 12); return Q(`Найдите НОД чисел ${latexList([a, b, c])}.`, gcd(gcd(a, b), c), { op: "gcd", args: [a, b, c] }); },
    () => { const a = 2 ** ri(1, 4) * 3 ** ri(1, 3), b = 2 ** ri(1, 4) * 3 ** ri(1, 3) * 5; return Q(`Найдите НОД чисел ${M(`A=${factorLatex(a)}`)} и ${M(`B=${factorLatex(b)}`)}.`, gcd(a, b), { op: "gcd", args: [a, b] }); },
    () => { const a = ri(10, 99), b = ri(10, 99); return yes(`Взаимно просты ли ${M(a)} и ${M(b)}?`, gcd(a, b) === 1, { op: "coprime", args: [a, b] }); },
    () => { const a = ri(12, 60), g = pick(divisors(a)), l = ri(1, 30), h = l + 80, values = range(l, h).filter(n => gcd(a, n) === g); return Q(`Найдите наименьшее натуральное ${M("x")} от ${M(l)} до ${M(h)} включительно, для которого ${M(`\\gcd(${a},x)=${g}`)}.`, values[0], { op: "gcd_search", args: [a, g, l, h] }); },
  ],
  5: [
    () => { const a = ri(3, 30), b = ri(3, 30); return Q(`Найдите НОК чисел ${M(a)} и ${M(b)}.`, lcm(a, b), { op: "lcm", args: [a, b] }); },
    () => { const a = ri(3, 15), b = ri(3, 15), c = ri(3, 15); return Q(`Найдите НОК чисел ${latexList([a, b, c])}.`, lcm(lcm(a, b), c), { op: "lcm", args: [a, b, c] }); },
    () => { const a = 2 ** ri(1, 4) * 3 ** ri(1, 3), b = 2 ** ri(1, 3) * 5 ** ri(1, 2); return Q(`Найдите НОК чисел ${M(`A=${factorLatex(a)}`)} и ${M(`B=${factorLatex(b)}`)}.`, lcm(a, b), { op: "lcm", args: [a, b] }); },
    () => { const a = ri(3, 15), b = ri(3, 15), lower = ri(30, 200), period = lcm(a, b); return Q(`Найдите наименьшее общее кратное ${M(a)} и ${M(b)}, строго большее ${M(lower)}.`, (Math.floor(lower / period) + 1) * period, { op: "next_multiple", args: [a, b, lower] }); },
    () => { const a = ri(3, 15), b = ri(3, 15); return Q(`Два сигнала звучат каждые ${M(a)} и ${M(b)} минут. Сейчас они прозвучали вместе. Через сколько минут они впервые снова прозвучат вместе?`, lcm(a, b), { op: "lcm", args: [a, b] }); },
    () => { const a = ri(3, 12), b = ri(3, 12), c = ri(3, 12); return Q(`Три лампы мигают с интервалами ${latexList([a, b, c])} секунд. Сейчас они мигнули вместе. Через сколько секунд это впервые повторится?`, lcm(lcm(a, b), c), { op: "lcm", args: [a, b, c] }); },
  ],
  6: [
    ...[false, true].map(zero => () => { const d = ri(3, 25), q = ri(2, 40), r = zero ? 0 : ri(1, d - 1), n = q * d + r; return Q(`Разделите ${M(n)} на ${M(d)} с остатком. Введите сначала неполное частное, затем остаток через точку с запятой.`, `${q};${r}`, { op: "division", args: [n, d] }, "integer_list", "Введите два целых числа: частное; остаток. Порядок важен."); }),
    () => { const d = ri(3, 25), q = ri(2, 40), r = ri(0, d - 1); return Q(`Делитель равен ${M(d)}, неполное частное ${M(q)}, остаток ${M(r)}. Найдите делимое.`, d * q + r, { op: "dividend", args: [d, q, r] }); },
    ...[false, true].map(valid => () => { const d = ri(3, 25), r = valid ? ri(0, d - 1) : pick([-ri(1, 8), d, d + ri(1, 8)]); return yes(`Может ли при делении натурального числа на ${M(d)} остаток равняться ${M(r)}?`, valid, { op: "valid_remainder", args: [d, r] }); }),
    () => { const d = ri(3, 15), n = ri(20, 250); return Q(`Из ${M(n)} карандашей собирают полные наборы по ${M(d)} карандашей. Сколько полных наборов получится и сколько карандашей останется? Введите два числа в этом порядке.`, `${Math.floor(n / d)};${n % d}`, { op: "division", args: [n, d] }, "integer_list", "Полных наборов; оставшихся карандашей."); },
  ],
  7: [
    ...[false, true].flatMap(two => ["min", "max", "all"].map(mode => () => residueTask(two, mode))),
    () => residueTask(true, "min", true),
  ],
  8: [
    ...[2, 3, 5, 9, 10].map(d => () => digitTask([d])),
    () => digitTask([3, 5]),
    () => digitTask([2, 9], "count"),
    () => digitTask([3], "min"),
    () => digitTask([3], "max"),
    () => digitTask([9], "all", true),
    () => digitTask([3], "count", true),
  ],
  9: [
    ...range(0, 9).map(last => () => { const a = ri(1, 30) * 10 + last, e = ri(100, 99999); return Q(`Найдите последнюю цифру ${M(`${a}^{${e}}`)}.`, modPower(a, e), { op: "last_power", args: [a, e] }); }),
    () => { const a = pick([2, 3, 7, 8]), e = ri(100, 9999), length = 4; return Q(`Цикл последних цифр степеней ${M(a)} имеет длину ${M(length)}. Найдите остаток от деления показателя ${M(e)} на длину цикла.`, e % length, { op: "remainder", args: [e, length] }); },
    () => { const a = pick([2, 3, 7, 8]), e = 4 * ri(25, 999); return Q(`Найдите последнюю цифру ${M(`${a}^{${e}}`)}.`, modPower(a, e), { op: "last_power", args: [a, e] }); },
    () => { const a = pick([2, 3, 7, 8]); return Q(`Запишите последние цифры ${M(`${a}^{1},${a}^{2},${a}^{3},${a}^{4}`)} в этом порядке.`, range(1, 4).map(e => modPower(a, e)).join(";"), { op: "power_cycle", args: [a] }, "integer_list", "Введите четыре цифры через ; в порядке показателей, без сортировки."); },
  ],
  10: [
    () => { const a = ri(11, 999), b = ri(11, 999), c = ri(11, 999); return Q(`Найдите последнюю цифру произведения ${M(`${a}\\cdot${b}\\cdot${c}`)} без вычисления всего произведения.`, a % 10 * (b % 10) * (c % 10) % 10, { op: "last_product", args: [a, b, c] }); },
    () => { const a = ri(12, 99), b = ri(12, 99), e = ri(30, 999), f = ri(30, 999); return Q(`Найдите последнюю цифру ${M(`${a}^{${e}}\\cdot${b}^{${f}}`)}.`, modPower(a, e) * modPower(b, f) % 10, { op: "last_power_product", args: [a, e, b, f] }); },
    () => { const a = ri(11, 999), b = ri(11, 999), c = ri(11, 999), d = ri(11, 999); return Q(`Найдите последнюю цифру ${M(`${a}\\cdot${b}+${c}\\cdot${d}`)}.`, (a * b + c * d) % 10, { op: "last_sum_products", args: [a, b, c, d] }); },
    () => { const a = ri(200, 999), b = ri(200, 999), c = ri(11, 99), d = ri(11, 99); return Q(`Найдите последнюю цифру ${M(`${a}\\cdot${b}-${c}\\cdot${d}`)}.`, (a * b - c * d) % 10, { op: "last_difference_products", args: [a, b, c, d] }); },
    () => { const a = ri(12, 99), b = ri(12, 99), e = ri(30, 999), f = ri(30, 999); return Q(`Найдите последнюю цифру ${M(`${a}^{${e}}+${b}^{${f}}`)}.`, (modPower(a, e) + modPower(b, f)) % 10, { op: "last_power_sum", args: [a, e, b, f] }); },
  ],
  11: [
    () => { const a = ri(1, 5), b = ri(1, 4), c = ri(1, 2); return Q(`Сколько натуральных делителей у ${M(`N=2^{${a}}\\cdot3^{${b}}\\cdot5^{${c}}`)}?`, (a + 1) * (b + 1) * (c + 1), { op: "divisor_count", args: [2 ** a * 3 ** b * 5 ** c] }); },
    () => { const p = pick(primes), e = ri(2, 7); return Q(`Сколько натуральных делителей у ${M(`${p}^{${e}}`)}?`, e + 1, { op: "prime_power_count", args: [p, e] }); },
    () => { const a = 2 ** ri(1, 4), b = 3 ** ri(1, 3) * 5 ** ri(1, 2); return Q(`Числа ${M(a)} и ${M(b)} взаимно просты. Сколько натуральных делителей у их произведения?`, factorization(a * b).reduce((v, [, e]) => v * (e + 1), 1), { op: "coprime_product_count", args: [a, b] }); },
    () => { const e = ri(1, 8), b = ri(1, 4), count = (e + 1) * (b + 1); return Q(`Число ${M(`N=2^x\\cdot3^{${b}}`)} имеет ${M(count)} натуральных делителей. Найдите натуральное ${M("x")}.`, e, { op: "missing_exponent", args: [3, b, count] }); },
    () => { const n = ri(10, 200); return Q(`Сколько натуральных делителей имеет число ${M(n)}?`, divisors(n).length, { op: "divisor_count", args: [n] }); },
  ],
};


// Contexts require choosing GCD/LCM from the situation, without naming the operation.
skills[4].push(() => { const a=ri(2,12)*ri(2,5),b=ri(2,12)*ri(2,5);return Q(`Есть ${M(a)} тетрадей и ${M(b)} карандашей. Их распределяют без остатка в одинаковые наборы (в каждом есть оба вида предметов). Какое наибольшее число наборов можно сделать?`,gcd(a,b),{op:"gcd",args:[a,b]}); });
skills[4].push(() => { const a=ri(10,30),b=ri(10,30);return Q(`Ленты длиной ${M(a)} см и ${M(b)} см разрезают без остатков на одинаковые отрезки. Найдите наибольшую возможную длину отрезка в сантиметрах.`,gcd(a,b),{op:"gcd",args:[a,b]}); });
skills[5].push(() => { const a=ri(3,12),b=ri(3,12);return Q(`Конфеты можно разложить без остатка как по ${M(a)}, так и по ${M(b)} штук. Какое наименьшее положительное количество конфет подходит?`,lcm(a,b),{op:"lcm",args:[a,b]}); });
skills[5].push(() => { const a=ri(3,10),b=ri(3,10),c=ri(3,10);return Q(`В коробках помещается по ${M(a)}, ${M(b)} или ${M(c)} деталей. Найдите наименьшее положительное число деталей, которое заполняет целое число коробок каждого размера без остатка.`,lcm(lcm(a,b),c),{op:"lcm",args:[a,b,c]}); });
for(const remainder of [false,true]) skills[6].push(() => { const d=ri(4,18),q=ri(3,20),r=remainder?ri(1,d-1):0,n=d*q+r;return Q(`Все ${M(n)} книг нужно разместить в коробках вместимостью не более ${M(d)} книг. Сколько коробок потребуется как минимум? Последняя коробка может быть неполной.`,q+Number(r>0),{op:"boxes",args:[n,d]}); });
for(const d of [2,3,4,5,6,7,8,9,10]) skills[8].push(() => {
  const prefix=ri(10,98),values=range(0,9).filter(x=>(prefix*10+x)%d===0);
  // A ten-number block always contains a multiple of every divisor 2..10.
  return Q(`Запишите все цифры ${M("x")} по возрастанию, для которых число ${M(`\\overline{${prefix}x}`)} делится на ${M(d)}. Цифра может быть нулём.`,list(values),{op:"last_digit_fill",args:[prefix,d]},"integer_list");
});


const practiceStart = Object.fromEntries(Object.entries(skills).map(([key, value])=>[key,value.length]));
skills[1].push(() => { const d=ri(2,9),l=ri(10,30),h=l+ri(20,50);return Q(`Сколько чисел от ${M(l)} до ${M(h)} включительно кратны ${M(d)}, но не кратны ${M(2*d)}?`,range(l,h).filter(n=>n%d===0&&n%(2*d)!==0).length,{op:"exclusive_multiples",args:[l,h,d,2*d]}); });
skills[1].push(() => { const d=ri(3,15),l=ri(1,20),h=l+40;const values=range(l+1,h-1).filter(n=>n%d===0);return Q(`Запишите кратные ${M(d)}, которые строго больше ${M(l)} и строго меньше ${M(h)}, по возрастанию.`,list(values),{op:"multiples",args:[d,l+1,h-1]},"integer_list"); });
skills[2].push(() => { const p=pick(primes.slice(0,6));return yes(`Является ли квадрат ${M(`${p}^{2}`)} простым числом?`,false,{op:"prime",args:[p*p]}); });
skills[2].push(() => { const n=2**ri(1,4)*3**ri(1,3)*pick([1,5,7]);return Q(`Сколько различных простых делителей у числа ${M(n)}? Каждый делитель учитывайте один раз.`,factorization(n).length,{op:"prime_divisor_count",args:[n]}); });
skills[4].push(() => { const n=ri(3,25),b=n*ri(2,8);return Q(`Найдите НОД чисел ${M(n)} и ${M(b)}.`,n,{op:"gcd",args:[n,b]}); });
skills[4].push(() => { const n=ri(10,50);return Q(`Найдите НОД двух соседних натуральных чисел ${M(n)} и ${M(n+1)}.`,1,{op:"gcd",args:[n,n+1]}); });
skills[5].push(() => { const n=ri(3,20),b=n*ri(2,8);return Q(`Найдите НОК чисел ${M(n)} и ${M(b)}. Одно число кратно другому.`,b,{op:"lcm",args:[n,b]}); });
skills[5].push(() => { const n=ri(3,12),b=n+1;return Q(`Красные флажки ставят через ${M(n)} метров, синие — через ${M(b)} метров. На старте стоят оба флажка. На каком наименьшем положительном расстоянии от старта снова будут оба? Введите метры.`,lcm(n,b),{op:"lcm",args:[n,b]}); });
skills[6].push(() => { const d=ri(5,20),n=ri(1,d-1);return Q(`Разделите ${M(n)} на ${M(d)} с остатком. Введите неполное частное и остаток через точку с запятой.`, `0;${n}`,{op:"division",args:[n,d]},"integer_list"); });
skills[6].push(() => { const q=ri(2,15),d=ri(3,15),rem=ri(1,d-1),n=q*d+rem;return Q(`При делении ${M(n)} на неизвестный делитель получилось неполное частное ${M(q)} и остаток ${M(rem)}. Найдите делитель.`,d,{op:"division_divisor",args:[n,q,rem]}); });
skills[7].push(() => residueTask(false,"count"));
skills[7].push(() => residueTask(true,"count"));
skills[10].push(() => { const a=ri(2,50)*10+5,b=ri(2,50)*10+2;return Q(`Найдите последнюю цифру ${M(`${a}\\cdot${b}`)}.`,0,{op:"last_product",args:[a,b]}); });
skills[10].push(() => { const a=ri(20,80),b=ri(2,15),c=ri(2,15);return Q(`Найдите последнюю цифру ${M(`${a}\\cdot(${b}+${c})`)}.`,a*(b+c)%10,{op:"last_product",args:[a,b+c]}); });
skills[11].push(() => { const p=pick(primes);return Q(`Сколько натуральных делителей имеет простое число ${M(p)}?`,2,{op:"divisor_count",args:[p]}); });
skills[11].push(() => { const p=pick(primes.slice(0,6)),q=pick(primes.filter(n=>n!==p));return Q(`Сколько натуральных делителей у ${M(`${p}\\cdot${q}`)}, где оба множителя простые и различные?`,4,{op:"divisor_count",args:[p*q]}); });
for(const [key,start] of Object.entries(practiceStart)) {
  const skill=Number(key);
  skills[skill]=skills[skill].map((make,index)=>index<start?make:()=>{const task=make();return {...task,parameters:{...task.parameters,practice_level:"CORE"}};});
}

export const NIS_TWO_TEMPLATE_COUNTS = Object.fromEntries(Object.entries(skills).map(([key, value]) => [key, value.length]));
export function isNisTwoGenerator(key: string) { return /^nis_new_s2_(?:[1-9]|1[01])_v2$/.test(key); }
export function generateNisTwoTasks(key: string): GeneratedSection1Task[] {
  if (!isNisTwoGenerator(key)) throw new Error("Unknown module two generator");
  const skill = Number(key.split("_")[3]);
  const templates = skills[skill].map((make, index) => ({ make, index }));
  const chosen = [...templates]; while (chosen.length < 12) chosen.push(pick(templates));
  const prompts = new Set<string>();
  return shuffle(chosen.map(({ make, index }) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      const t = make();
      if (prompts.has(t.prompt)) continue;
      prompts.add(t.prompt);
      return { ...t, difficulty: t.parameters.practice_level === "CORE" ? "CORE" : index === 0 ? "BASIC" : index === templates.length - 1 ? "CHALLENGE" : "CORE", parameters: { ...t.parameters, template: `nis-new-2.${skill}-${index + 1}` } };
    }
    throw new Error(`Cannot generate unique task for 2.${skill}-${index + 1}`);
  }));
}
