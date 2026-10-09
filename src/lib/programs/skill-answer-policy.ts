/** Public input metadata only. Expected answers remain on the server. */
export type SkillAnswerKind = "integer" | "decimal" | "fraction" | "mixed" | "number" | "sequence" | "inequality" | "power" | "integer_list" | "factorization";
export type SkillAnswerMeta = { answerKind: SkillAnswerKind; answerHint: string };
type Params = Record<string, unknown>;

export const INVALID_FORMAT = "!format";
function gcd(a: bigint, b: bigint): bigint {
  a = a < BigInt(0) ? -a : a;
  while (b) [a, b] = [b, a % b];
  return a || BigInt(1);
}
function ratio(n: bigint, d: bigint) {
  const g = gcd(n, d); n /= g; d /= g;
  return d === BigInt(1) ? String(n) : `${n}/${d}`;
}
function numeric(s: string, kind: SkillAnswerKind, reduced: boolean): string | null {
  let m: RegExpMatchArray | null;
  if ((kind === "mixed" || kind === "number") && (m = s.match(/^([+-]?)(\d+)\s+(\d+)\s*\/\s*(\d+)$/))) {
    const whole = BigInt(m[2]), n = BigInt(m[3]), d = BigInt(m[4]);
    if (!d || n <= BigInt(0) || n >= d || whole === BigInt(0) || (reduced && gcd(n, d) !== BigInt(1))) return null;
    return ratio((m[1] === "-" ? -BigInt(1) : BigInt(1)) * (whole * d + n), d);
  }
  if ((kind === "fraction" || kind === "number") && (m = s.match(/^([+-]?\d+)\s*\/\s*(\d+)$/))) {
    const n = BigInt(m[1]), d = BigInt(m[2]);
    if (!d || (reduced && gcd(n, d) !== BigInt(1))) return null;
    return ratio(n, d);
  }
  if (["integer", "decimal", "number"].includes(kind) && (m = s.match(/^([+-]?)(\d+)(?:[,.](\d+))?$/))) {
    if (kind === "integer" && m[3] !== undefined) return null;
    const frac = m[3] ?? "";
    return ratio((m[1] === "-" ? -BigInt(1) : BigInt(1)) * BigInt(m[2] + frac), BigInt(10) ** BigInt(frac.length));
  }
  return null;
}

export function answerMeta(parameters: Params, fallback = ""): SkillAnswerMeta {
  const hint = typeof parameters.answer_hint === "string" ? parameters.answer_hint : "";
  const kind = parameters.answer_kind;
  if (["integer", "decimal", "fraction", "mixed", "number", "sequence", "inequality", "power", "integer_list", "factorization"].includes(String(kind))) {
    return { answerKind: kind as SkillAnswerKind, answerHint: hint };
  }
  const display = String(parameters.answer_display ?? fallback);
  return { answerKind: /^-?\d+\s+\d+\/\d+$/.test(display) ? "mixed" : display.includes("/") ? "fraction" : /[,.]/.test(display) ? "decimal" : "integer", answerHint: hint };
}

/** null means empty/oversized. A nonempty answer in the wrong form is graded wrong. */
export function normalizeStrictSkillAnswer(raw: unknown, parameters: Params): string | null {
  if (typeof raw !== "string" || raw.length > 100 || !raw.trim()) return null;
  const s = raw.trim().replaceAll("−", "-").replaceAll("\u00a0", " ");
  const kind = answerMeta(parameters).answerKind;
  if (kind === "integer_list") {
    const parts = s.split(";");
    if (parts.length > 50) return INVALID_FORMAT;
    const values = parts.map(part => numeric(part.trim(), "integer", false));
    return values.every(Boolean) ? values.join(";") : INVALID_FORMAT;
  }
  if (kind === "factorization") {
    const factors = s.replace(/[×·]/g, "*").replace(/\s/g, "").split("*");
    let value = BigInt(1);
    for (const factor of factors) {
      const m = factor.match(/^(\d+)(?:\^(\d+))?$/);
      if (!m) return INVALID_FORMAT;
      const p = Number(m[1]), exponent = Number(m[2] ?? 1);
      if (!Number.isSafeInteger(p) || p < 2 || p > 100000 || !Number.isInteger(exponent) || exponent < 1 || exponent > 20) return INVALID_FORMAT;
      for (let d = 2; d * d <= p; d++) if (p % d === 0) return INVALID_FORMAT;
      value *= BigInt(p) ** BigInt(exponent);
      if (value.toString().length > 100) return INVALID_FORMAT;
    }
    return String(value);
  }
  if (kind === "sequence") {
    const parts = s.split(";");
    if (parts.length < 2 || parts.length > 15) return INVALID_FORMAT;
    const values = parts.map(part => numeric(part.trim(), "number", false));
    return values.every(Boolean) ? values.join(";") : INVALID_FORMAT;
  }
  if (kind === "inequality") {
    const compact = s.replace(/\s/g, "");
    const m = compact.match(/^(-?\d+)<(-?\d+)<(-?\d+)$/);
    return m ? `${BigInt(m[1])}<${BigInt(m[2])}<${BigInt(m[3])}` : INVALID_FORMAT;
  }
  if (kind === "power") {
    const m = s.replace(/\s/g, "").match(/^(\d+)\^(\d+)$/);
    return m ? `${BigInt(m[1])}^${BigInt(m[2])}` : INVALID_FORMAT;
  }
  if (parameters.no_trailing_zeros === true && /[,.]\d*0$/.test(s)) return INVALID_FORMAT;
  if (typeof parameters.decimal_places === "number") {
    const match = s.match(/[,.](\d+)$/);
    if ((match?.[1].length ?? 0) !== parameters.decimal_places) return INVALID_FORMAT;
  }
  return numeric(s, kind, parameters.require_reduced === true) ?? INVALID_FORMAT;
}
