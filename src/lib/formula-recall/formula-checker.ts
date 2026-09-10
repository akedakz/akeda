import { ComputeEngine, type Expression } from "@cortex-js/compute-engine";

export type FormulaCheckReason =
  | "equivalent_canonical"
  | "equivalent_alternative"
  | "not_equivalent"
  | "empty_answer"
  | "invalid_expression"
  | "equation_required"
  | "unsupported_expression"
  | "reference_unavailable"
  | "complexity_limit";

export type FormulaCheckResult = { correct: boolean; reason: FormulaCheckReason };
export type FormulaCheckInput = {
  studentExpression: string;
  canonicalExpression: string;
  alternativeExpressions?: readonly string[];
};

type Rational = { numerator: number; denominator: number };
type Polynomial = Map<string, Rational>;
type RationalPolynomial = { numerator: Polynomial; denominator: Polynomial };

const MAX_EXPRESSION_LENGTH = 4000;
const MAX_ALTERNATIVES = 20;
const MAX_TERMS = 500;
const MAX_POWER = 12;
const ONE: Rational = { numerator: 1, denominator: 1 };

class UnsupportedExpressionError extends Error {}
class ComplexityLimitError extends Error {}

// Representation only: preserve code-point identity, including Greek/Cyrillic
// lookalikes. MathLive's phi glyph is varphi; phi/ϕ remain a distinct glyph.
const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", rho: "ρ", varrho: "ϱ",
  sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "ϕ", varphi: "φ",
  chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ",
  Lambda: "Λ", Xi: "Ξ", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};
const greekGlyphs = new Set(Object.values(GREEK));
function identifierToken(parts: string[]) {
  // Injective encoding, not transliteration. Keep base and label boundaries.
  const encoded = parts.map((part) => Array.from(part).map((char) => char.codePointAt(0)!.toString(16).padStart(6, "0")).join("")).join("z");
  return `\\mathrm{nspfr${encoded}}`;
}

export function normalizeFormulaLatex(input: string): string {
  if (/nspfr/i.test(input)) throw new UnsupportedExpressionError();
  let text = input.trim();
  if (text.startsWith("$$") && text.endsWith("$$")) text = text.slice(2, -2);
  else if (text.startsWith("$") && text.endsWith("$")) text = text.slice(1, -1);
  else if ((text.startsWith("\\(") && text.endsWith("\\)")) || (text.startsWith("\\[") && text.endsWith("\\]"))) text = text.slice(2, -2);
  text = text.replace(/\\([A-Za-z]+)\b\s*/g, (match, command: string) => Object.hasOwn(GREEK, command) ? GREEK[command] : match);
  // Upright single-letter variables are the same identifiers, not text strings.
  text = text.replace(/\\(?:mathrm|mathit)\{([\p{L}])\}/gu, "$1");
  // Only atomic labels: do not flatten products, sums or symbolic expressions.
  // Compact unbraced Cyrillic labels are the legacy school-physics notation.
  text = text.replace(/([\p{L}])\s*_\s*(?:\{\\(?:text|mathrm|mathit)\{([\p{L}\p{N}]+)\}\}|\{([\p{L}\p{N}]+)\}|([\p{Script=Cyrillic}]+)|([\p{L}\p{N}]))/gu,
    (match, base: string, styled: string, braced: string, cyrillic: string, single: string, offset: number, source: string) => {
      if (/\\[A-Za-z]*$/.test(source.slice(0, offset))) return match;
      return identifierToken([base, styled ?? braced ?? cyrillic ?? single]);
    });
  text = text.replace(/[\p{Script=Greek}\p{Script=Cyrillic}]/gu, (char) => {
    if (char === "π") return "\\pi "; // Retain the existing mathematical constant.
    if (greekGlyphs.has(char) || /\p{Script=Cyrillic}/u.test(char)) return identifierToken([char]);
    throw new UnsupportedExpressionError();
  });
  // Plain sqrt(...) is not LaTeX (CE reads s*q*r*t); never guess its meaning.
  if (/(^|[^\\\p{L}])sqrt\s*\(/u.test(text)) throw new UnsupportedExpressionError();
  return text;
}

function assertMathematicalJson(json: unknown): void {
  if (typeof json === "string" && (json.startsWith("'") || ["NaN", "Nothing", "Undefined", "PositiveInfinity", "NegativeInfinity", "ComplexInfinity"].includes(json))) throw new UnsupportedExpressionError();
  if (Array.isArray(json)) {
    if (["Error", "Text", "String", "Sequence", "List"].includes(String(json[0]))) throw new UnsupportedExpressionError();
    for (const child of json.slice(1)) assertMathematicalJson(child);
  }
}

function gcd(a: number, b: number) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) [a, b] = [b, a % b];
  return a || 1;
}

function rational(numerator: number, denominator = 1): Rational {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0) throw new ComplexityLimitError();
  if (denominator < 0) { numerator = -numerator; denominator = -denominator; }
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function addRational(a: Rational, b: Rational) {
  return rational(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
}

function multiplyRational(a: Rational, b: Rational) {
  return rational(a.numerator * b.numerator, a.denominator * b.denominator);
}

function numberRational(value: number): Rational {
  if (!Number.isFinite(value)) throw new UnsupportedExpressionError();
  const text = String(value).toLowerCase();
  const [mantissa, exponentText = "0"] = text.split("e");
  const exponent = Number(exponentText);
  const negative = mantissa.startsWith("-");
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const [integer, decimal = ""] = unsigned.split(".");
  let numerator = Number(`${integer || "0"}${decimal}`);
  let denominator = 10 ** decimal.length;
  if (exponent >= 0) numerator *= 10 ** exponent;
  else denominator *= 10 ** -exponent;
  return rational(negative ? -numerator : numerator, denominator);
}

function constantPolynomial(value: Rational): Polynomial {
  return value.numerator === 0 ? new Map() : new Map([["", value]]);
}

function atomPolynomial(atom: unknown): Polynomial {
  return new Map([[JSON.stringify([JSON.stringify(atom), 1]), ONE]]);
}

function checkSize(poly: Polynomial) {
  if (poly.size > MAX_TERMS) throw new ComplexityLimitError();
  return poly;
}

function addPolynomial(a: Polynomial, b: Polynomial): Polynomial {
  const result = new Map(a);
  for (const [key, value] of b) {
    const next = addRational(result.get(key) ?? rational(0), value);
    if (next.numerator === 0) result.delete(key); else result.set(key, next);
  }
  return checkSize(result);
}

function negatePolynomial(poly: Polynomial): Polynomial {
  return new Map([...poly].map(([key, value]) => [key, rational(-value.numerator, value.denominator)]));
}

function decodeMonomial(key: string): Array<[string, number]> {
  if (!key) return [];
  const parsed = JSON.parse(key) as [string, number] | Array<[string, number]>;
  return typeof parsed[0] === "string" ? [parsed as [string, number]] : parsed as Array<[string, number]>;
}

function encodeMonomial(entries: Array<[string, number]>) {
  const compact = entries.filter(([, count]) => count !== 0).sort(([a], [b]) => a.localeCompare(b));
  return compact.length === 0 ? "" : compact.length === 1 ? JSON.stringify(compact[0]) : JSON.stringify(compact);
}

function multiplyMonomialKeys(a: string, b: string) {
  const counts = new Map<string, number>();
  for (const [atom, count] of [...decodeMonomial(a), ...decodeMonomial(b)]) counts.set(atom, (counts.get(atom) ?? 0) + count);
  return encodeMonomial([...counts]);
}

function multiplyPolynomial(a: Polynomial, b: Polynomial): Polynomial {
  if (a.size === 0 || b.size === 0) return new Map();
  const result: Polynomial = new Map();
  for (const [aKey, aValue] of a) for (const [bKey, bValue] of b) {
    const key = multiplyMonomialKeys(aKey, bKey);
    const next = addRational(result.get(key) ?? rational(0), multiplyRational(aValue, bValue));
    if (next.numerator === 0) result.delete(key); else result.set(key, next);
  }
  return checkSize(result);
}

function commonMonomial(poly: Polynomial) {
  let common: Map<string, number> | null = null;
  for (const key of poly.keys()) {
    const current = new Map(decodeMonomial(key));
    if (common === null) common = current;
    else for (const [atom, count] of common) common.set(atom, Math.min(count, current.get(atom) ?? 0));
  }
  return common ?? new Map<string, number>();
}

function divideByMonomial(poly: Polynomial, divisor: Map<string, number>) {
  if ([...divisor.values()].every((count) => count === 0)) return poly;
  const result: Polynomial = new Map();
  for (const [key, coefficient] of poly) {
    const counts = new Map(decodeMonomial(key));
    for (const [atom, count] of divisor) counts.set(atom, (counts.get(atom) ?? 0) - count);
    result.set(encodeMonomial([...counts]), coefficient);
  }
  return result;
}

function normalizeFraction(value: RationalPolynomial): RationalPolynomial {
  if (value.numerator.size === 0) return { numerator: value.numerator, denominator: constantPolynomial(ONE) };
  const numeratorCommon = commonMonomial(value.numerator);
  const denominatorCommon = commonMonomial(value.denominator);
  const shared = new Map<string, number>();
  for (const [atom, count] of numeratorCommon) {
    const amount = Math.min(count, denominatorCommon.get(atom) ?? 0);
    if (amount > 0) shared.set(atom, amount);
  }
  return { numerator: divideByMonomial(value.numerator, shared), denominator: divideByMonomial(value.denominator, shared) };
}

function powerPolynomial(poly: Polynomial, exponent: number) {
  let result = constantPolynomial(ONE);
  let base = poly;
  let remaining = exponent;
  while (remaining > 0) {
    if (remaining % 2 === 1) result = multiplyPolynomial(result, base);
    remaining = Math.floor(remaining / 2);
    if (remaining) base = multiplyPolynomial(base, base);
  }
  return result;
}

function addFractions(a: RationalPolynomial, b: RationalPolynomial): RationalPolynomial {
  return normalizeFraction({
    numerator: addPolynomial(multiplyPolynomial(a.numerator, b.denominator), multiplyPolynomial(b.numerator, a.denominator)),
    denominator: multiplyPolynomial(a.denominator, b.denominator),
  });
}

function multiplyFractions(a: RationalPolynomial, b: RationalPolynomial): RationalPolynomial {
  return normalizeFraction({ numerator: multiplyPolynomial(a.numerator, b.numerator), denominator: multiplyPolynomial(a.denominator, b.denominator) });
}

function fractionFromJson(json: unknown): RationalPolynomial {
  if (typeof json === "number") return { numerator: constantPolynomial(numberRational(json)), denominator: constantPolynomial(ONE) };
  if (typeof json === "string") return { numerator: atomPolynomial(json), denominator: constantPolynomial(ONE) };
  if (!Array.isArray(json) || typeof json[0] !== "string") throw new UnsupportedExpressionError();
  const [operator, ...operands] = json;
  if (operator === "Error" || operator === "Sequence" || operator === "List") throw new UnsupportedExpressionError();
  if (operator === "Rational" && operands.length === 2 && typeof operands[0] === "number" && typeof operands[1] === "number" && Number.isInteger(operands[0]) && Number.isInteger(operands[1])) {
    return { numerator: constantPolynomial(rational(operands[0], operands[1])), denominator: constantPolynomial(ONE) };
  }
  if (operator === "Sqrt" && operands.length === 1 && Array.isArray(operands[0]) && operands[0][0] === "Divide" && operands[0].length === 3) {
    return {
      numerator: atomPolynomial(["Sqrt", operands[0][1]]),
      denominator: atomPolynomial(["Sqrt", operands[0][2]]),
    };
  }
  if (operator === "Negate" && operands.length === 1) {
    const value = fractionFromJson(operands[0]);
    return { numerator: negatePolynomial(value.numerator), denominator: value.denominator };
  }
  if (operator === "Add") return operands.map(fractionFromJson).reduce(addFractions);
  if (operator === "Multiply") return operands.map(fractionFromJson).reduce(multiplyFractions);
  if (operator === "Divide" && operands.length === 2) {
    const left = fractionFromJson(operands[0]);
    const right = fractionFromJson(operands[1]);
    if (right.numerator.size === 0) throw new UnsupportedExpressionError();
    return normalizeFraction({ numerator: multiplyPolynomial(left.numerator, right.denominator), denominator: multiplyPolynomial(left.denominator, right.numerator) });
  }
  if (operator === "Power" && operands.length === 2 && typeof operands[1] === "number" && Number.isInteger(operands[1]) && Math.abs(operands[1]) <= MAX_POWER) {
    const base = fractionFromJson(operands[0]);
    const exponent = operands[1];
    if (exponent >= 0) return { numerator: powerPolynomial(base.numerator, exponent), denominator: powerPolynomial(base.denominator, exponent) };
    if (base.numerator.size === 0) throw new UnsupportedExpressionError();
    return { numerator: powerPolynomial(base.denominator, -exponent), denominator: powerPolynomial(base.numerator, -exponent) };
  }
  return { numerator: atomPolynomial(json), denominator: constantPolynomial(ONE) };
}

function proportional(a: Polynomial, b: Polynomial) {
  if (a.size === 0 || b.size === 0 || a.size !== b.size) return false;
  const keys = [...a.keys()].sort();
  if (keys.some((key) => !b.has(key))) return false;
  const firstA = a.get(keys[0])!;
  const firstB = b.get(keys[0])!;
  if (firstA.numerator === 0 || firstB.numerator === 0) return false;
  return keys.every((key) => {
    const left = a.get(key)!;
    const right = b.get(key)!;
    return left.numerator * right.denominator * firstB.numerator * firstA.denominator
      === right.numerator * left.denominator * firstA.numerator * firstB.denominator;
  });
}

function equationNumerator(engine: ComputeEngine, latex: string): Polynomial {
  const expression = engine.parse(normalizeFormulaLatex(latex));
  if (!expression.isValid || expression.errors.length || expression.subexpressions.length > MAX_TERMS) throw new UnsupportedExpressionError();
  assertMathematicalJson(expression.json);
  const operands = (expression as unknown as { ops: readonly Expression[] }).ops;
  if (expression.operator !== "Equal" || operands.length !== 2) throw new UnsupportedExpressionError("equation");
  const residual: Expression = operands[0].sub(operands[1]).simplify();
  if (!residual.isValid || residual.errors.length) throw new UnsupportedExpressionError();
  assertMathematicalJson(residual.json);
  return fractionFromJson(residual.json).numerator;
}

function compare(engine: ComputeEngine, student: Polynomial, accepted: string) {
  return proportional(student, equationNumerator(engine, accepted));
}

export function checkFormulaAnswer(input: FormulaCheckInput): FormulaCheckResult {
  const studentText = input.studentExpression.trim();
  if (!studentText) return { correct: false, reason: "empty_answer" };
  const alternatives = (input.alternativeExpressions ?? []).slice(0, MAX_ALTERNATIVES);
  if (studentText.length > MAX_EXPRESSION_LENGTH) {
    return { correct: false, reason: "invalid_expression" };
  }
  try {
    const engine = new ComputeEngine();
    engine.timeLimit = 500;
    engine.iterationLimit = 10_000;
    // Physics single-letter quantities must not resolve to library functions
    // such as N(). Scope-local declarations leave CE constants/macros intact.
    engine.pushScope();
    for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz") {
      if (letter !== "e" && letter !== "i") engine.declare(letter, "number");
    }
    const student = equationNumerator(engine, studentText);
    const accepted = [input.canonicalExpression, ...alternatives];
    let validAcceptedExpression = false;
    let validCanonical = false;
    for (const [index, expression] of accepted.entries()) {
      try {
        if (!expression.trim() || expression.length > MAX_EXPRESSION_LENGTH) throw new UnsupportedExpressionError();
        if (compare(engine, student, expression)) return { correct: true, reason: index === 0 ? "equivalent_canonical" : "equivalent_alternative" };
        validAcceptedExpression = true;
        if (index === 0) validCanonical = true;
      } catch {
        // A malformed alternative must not prevent another stored alternative from matching.
      }
    }
    return { correct: false, reason: validAcceptedExpression && validCanonical ? "not_equivalent" : "reference_unavailable" };
  } catch (error) {
    if (error instanceof ComplexityLimitError) return { correct: false, reason: "complexity_limit" };
    if (error instanceof UnsupportedExpressionError && error.message === "equation") return { correct: false, reason: "equation_required" };
    return { correct: false, reason: "unsupported_expression" };
  }
}
