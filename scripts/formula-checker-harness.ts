// Node's native TypeScript loader requires the extension; the application build resolves extensionless imports.
// @ts-expect-error TS5097 is intentionally suppressed for this standalone Node harness.
import { checkFormulaAnswer, normalizeFormulaLatex } from "../src/lib/formula-recall/formula-checker.ts";
import { ComputeEngine } from "@cortex-js/compute-engine";
import { convertLatexToMathMl, validateLatex } from "mathlive/ssr";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

type Case = { name: string; canonical: string; student: string; expected: boolean; alternatives?: string[]; reason?: string };

const cases: Case[] = [
  { name: "exact", canonical: "F=ma", student: "F=ma", expected: true },
  { name: "explicit multiplication", canonical: "F=ma", student: "F=m\\cdot a", expected: true },
  { name: "reversed sides", canonical: "F=ma", student: "ma=F", expected: true },
  { name: "zero form", canonical: "F=ma", student: "F-ma=0", expected: true },
  { name: "non-zero scalar", canonical: "F=ma", student: "2F=2ma", expected: true },
  { name: "wrong sign", canonical: "F=ma", student: "F=-ma", expected: false },
  { name: "missing factor", canonical: "F=ma", student: "F=m+a", expected: false },
  { name: "linear rearrangement", canonical: "v=u+at", student: "a=\\frac{v-u}{t}", expected: true },
  { name: "centripetal rearrangement", canonical: "F=\\frac{mv^2}{r}", student: "rF=mv^2", expected: true },
  { name: "density rearrangement", canonical: "p=\\rho gh", student: "\\rho=\\frac{p}{gh}", expected: true },
  { name: "subscript identity", canonical: "F_k=ma", student: "F_k=ma", expected: true },
  { name: "subscript mismatch", canonical: "F_k=ma", student: "F=ma", expected: false },
  { name: "greek mismatch", canonical: "p=\\rho gh", student: "p=rgh", expected: false },
  { name: "equation square adds branch", canonical: "x=y", student: "x^2=y^2", expected: false },
  { name: "pendulum rearrangement", canonical: "T=2\\pi\\sqrt{\\frac{l}{g}}", student: "\\frac{T}{2\\pi}=\\sqrt{\\frac{l}{g}}", expected: true },
  { name: "pendulum squared conservative", canonical: "T=2\\pi\\sqrt{\\frac{l}{g}}", student: "T^2=4\\pi^2\\frac{l}{g}", expected: false },
  { name: "decimal coefficient", canonical: "E_k=\\frac{mv^2}{2}", student: "E_k=0.5mv^2", expected: true },
  { name: "alternative", canonical: "p=\\rho gh", alternatives: ["p=F/S"], student: "F=pS", expected: true },
  { name: "alternatives checked independently", canonical: "F=ma", alternatives: ["\\frac{", "p=F/S"], student: "F=pS", expected: true },
  { name: "malformed", canonical: "F=ma", student: "\\frac{F}{", expected: false },
  { name: "expression is not equation", canonical: "F=ma", student: "F-ma", expected: false },
];

// Keep all original 21 cases. These fixtures use the shared editor's LaTeX
// vocabulary; SSR validates MathLive syntax, not a simulated browser keystroke.
cases.push(
  { name: "nu MathLive fraction", canonical: "ν=N/t", student: "\\nu=\\frac{N}{t}", expected: true },
  { name: "nu reverse encoding", canonical: "\\nu=\\frac{N}{t}", student: "ν=N/t", expected: true },
  { name: "nu N function collision exact", canonical: "\\nu=N/t", student: "\\nu=N/t", expected: true },
  { name: "nu is not Latin v", canonical: "ν=N/t", student: "v=N/t", expected: false },
  { name: "nu inverted fraction", canonical: "ν=N/t", student: "ν=t/N", expected: false },
  { name: "nu equality symmetric", canonical: "ν=N/t", student: "\\frac{N}{t}=\\nu", expected: true },
  { name: "nu display wrapper and whitespace", canonical: "ν=N/t", student: "$$ \\nu = \\frac{N}{t} $$", expected: true },
  { name: "nu MathLive parentheses", canonical: "ν=N/t", student: "\\nu=\\left(N\\right)/\\left(t\\right)", expected: true },
  { name: "division button", canonical: "ν=N/t", student: "\\nu=N\\div t", expected: true },
  { name: "no equality prefix guessing", canonical: "ν=N/t", student: "N/t", expected: false, reason: "equation_required" },
  { name: "Cyrillic compact label", canonical: "F_упр=kx", student: "F_{упр}=kx", expected: true },
  { name: "Cyrillic text label", canonical: "F_{упр}=kx", student: "F_{\\text{упр}}=kx", expected: true },
  { name: "Cyrillic upright label", canonical: "F_упр=kx", student: "F_{\\mathrm{упр}}=kx", expected: true },
  { name: "Cyrillic labels do not collapse to NaN", canonical: "F_упр=kx", student: "F_{тр}=kx", expected: false },
  { name: "Cyrillic truly wrong right side", canonical: "F_{упр}=kx", student: "F_{упр}=mg", expected: false },
  { name: "Cyrillic label not transliterated", canonical: "F_{упр}=kx", student: "F_{yпp}=kx", expected: false },
  { name: "unbraced Latin subscript not whole product", canonical: "F_{abc}=kx", student: "F_abc=kx", expected: false },
  { name: "explicit subscript product not label", canonical: "F_{ab}=kx", student: "F_{a\\cdot b}=kx", expected: false },
  { name: "outside product preserved", canonical: "F_{упр}=kx", student: "F_у пр=kx", expected: false },
  { name: "Cyrillic base same symbol", canonical: "х=ma", student: "х=am", expected: true },
  { name: "Cyrillic x is not Latin x", canonical: "х=ma", student: "x=ma", expected: false },
  { name: "Cyrillic a is not Latin a", canonical: "F=mа", student: "F=ma", expected: false },
  { name: "bare sqrt not guessed as product or radical", canonical: "x=\\sqrt{y}", student: "x=sqrt(y)", expected: false, reason: "unsupported_expression" },
  { name: "root serialization", canonical: "x=\\sqrt{y}", student: "x=\\sqrt{\\left(y\\right)}", expected: true },
  { name: "power braces", canonical: "F=mv^2/r", student: "F=mv^{2}/r", expected: true },
  { name: "symbolic power braces", canonical: "y=x^n", student: "y=x^{n}", expected: true },
  { name: "symbolic exponent product identity exact", canonical: "x^{m}\\cdot x^{n}=x^{m+n}", student: "x^{m}\\cdot x^{n}=x^{m+n}", expected: true },
  { name: "symbolic exponent product identity times button", canonical: "x^{m}\\cdot x^{n}=x^{m+n}", student: "x^{m}\\times x^{n}=x^{m+n}", expected: true },
  { name: "symbolic exponent product identity reversed", canonical: "x^{m}\\cdot x^{n}=x^{m+n}", student: "x^{m+n}=x^{m}\\cdot x^{n}", expected: true },
  { name: "symbolic exponent product wrong exponent", canonical: "x^{m}\\cdot x^{n}=x^{m+n}", student: "x^{m}\\cdot x^{n}=x^{m-n}", expected: false },
  { name: "symbolic exponent product tautology rejected", canonical: "x^{m}\\cdot x^{n}=x^{m+n}", student: "x^{m}\\cdot x^{n}=x^{m}\\cdot x^{n}", expected: false },
  { name: "symbolic exponent quotient identity exact", canonical: "\\frac{x^{m}}{x^{n}}=x^{m-n}", student: "\\frac{x^{m}}{x^{n}}=x^{m-n}", expected: true },
  { name: "symbolic power of power identity exact", canonical: "\\left(x^{m}\\right)^{n}=x^{mn}", student: "\\left(x^{m}\\right)^{n}=x^{mn}", expected: true },
  { name: "negative symbolic power identity", canonical: "x^{-m}=\\frac{1}{x^m}", student: "x^{-m}=\\frac{1}{x^{m}}", expected: true },
  { name: "negative symbolic power identity reversed", canonical: "x^{-m}=\\frac{1}{x^m}", student: "\\frac{1}{x^m}=x^{-m}", expected: true },
  { name: "negative symbolic power wrong exponent", canonical: "x^{-m}=\\frac{1}{x^m}", student: "x^{-m}=\\frac{1}{x^n}", expected: false },
  { name: "negative symbolic power reciprocal tautology rejected", canonical: "x^{-m}=\\frac{1}{x^m}", student: "\\frac{1}{x^m}=\\frac{1}{x^m}", expected: false },
  { name: "negative symbolic power self tautology rejected", canonical: "x^{-m}=\\frac{1}{x^m}", student: "x^{-m}=x^{-m}", expected: false },
  { name: "implicit multiplication reversed", canonical: "F=ma", student: "F=am", expected: true },
  { name: "implicit multiplication spaces", canonical: "F=ma", student: "F=m a", expected: true },
  { name: "multiplication button", canonical: "F=ma", student: "F=m\\times a", expected: true },
  { name: "parenthesized denominator", canonical: "x=a/(bc)", student: "x=\\frac{a}{b\\cdot c}", expected: true },
  { name: "alternative exact explicit symbol", canonical: "v=s/t", alternatives: ["u=s/t"], student: "u=s/t", expected: true, reason: "equivalent_alternative" },
  { name: "alternative Greek serialization", canonical: "v=s/t", alternatives: ["ν=N/t"], student: "\\nu=\\frac{N}{t}", expected: true, reason: "equivalent_alternative" },
  { name: "alternative indexed serialization", canonical: "F=ma", alternatives: ["F_упр=kx"], student: "F_{\\text{упр}}=kx", expected: true, reason: "equivalent_alternative" },
  { name: "alternative required for different symbols", canonical: "v=s/t", student: "u=s/t", expected: false },
  { name: "rearrangement already accepted without alternative", canonical: "v=s/t", student: "s=vt", expected: true },
  { name: "saved rearrangement candidate", canonical: "F=ma", alternatives: ["a=F/m"], student: "a=\\frac{F}{m}", expected: true },
  { name: "empty alternative does not poison canonical", canonical: "F=ma", alternatives: [""], student: "F=ma", expected: true },
  { name: "bad alternative before matching second", canonical: "F=ma", alternatives: ["", "ν=N/t"], student: "\\nu=N/t", expected: true, reason: "equivalent_alternative" },
  { name: "oversized alternative isolated", canonical: "F=ma", alternatives: ["x".repeat(4001), "p=F/S"], student: "F=pS", expected: true },
  { name: "neither candidate matches", canonical: "F=ma", alternatives: ["\\frac{", "p=F/S"], student: "F=m+a", expected: false, reason: "not_equivalent" },
  { name: "invalid canonical controlled", canonical: "\\frac{", student: "F=ma", expected: false, reason: "reference_unavailable" },
  { name: "invalid canonical with valid nonmatch remains controlled", canonical: "\\frac{", alternatives: ["p=F/S"], student: "F=ma", expected: false, reason: "reference_unavailable" },
  { name: "valid alternative can rescue invalid canonical", canonical: "\\frac{", alternatives: ["F=ma"], student: "F=ma", expected: true, reason: "equivalent_alternative" },
  { name: "NaN must never be a comparable atom", canonical: "F=ma", student: "x=0/0", expected: false },
  { name: "malformed nested radical", canonical: "x=\\sqrt{y}", student: "x=\\sqrt{\\frac{y}{}}", expected: false },
);
for (const [glyph, command] of [["ν", "nu"], ["ω", "omega"], ["ρ", "rho"], ["λ", "lambda"], ["μ", "mu"], ["θ", "theta"], ["α", "alpha"], ["β", "beta"], ["γ", "gamma"], ["φ", "varphi"], ["Δ", "Delta"], ["ϕ", "phi"], ["ε", "varepsilon"]]) {
  cases.push({ name: `Greek ${command} Unicode/LaTeX`, canonical: `${glyph}=a/b`, student: `\\${command}=\\frac{a}{b}`, expected: true });
}
for (const [greek, latin] of [["ρ", "p"], ["μ", "u"], ["α", "a"]]) cases.push({ name: `distinct ${greek}/${latin}`, canonical: `${greek}=F/S`, student: `${latin}=F/S`, expected: false });
for (const [base, label] of [["F", "тр"], ["F", "тяж"], ["a", "x"], ["v", "0"], ["x", "1"], ["I", "1"], ["U", "2"]]) cases.push({ name: `indexed ${base}_${label}`, canonical: `${base}_${label}=ma`, student: `${base}_{${label}}=ma`, expected: true });

// Prove the pre-fix CE collision and exercise MathLive's installed parser.
for (const term of ["\\pi", "e", "i", "\\sin(x)", "\\cos(x)", "\\tan(x)", "\\ln(x)", "\\log(x)", "\\sqrt{x}"]) {
  cases.push({ name: `reserved ${term} exact`, canonical: `y=${term}`, student: `y=${term}`, expected: true });
  cases.push({ name: `reserved ${term} wrong factor`, canonical: `y=${term}`, student: `y=2${term}`, expected: false });
}
cases.push(
  { name: "Euler constant retains exponential identity", canonical: "y=e", student: "y=\\exp(1)", expected: true },
  { name: "imaginary unit retains square identity", canonical: "y=i^2", student: "y=-1", expected: true },
  { name: "pi Unicode matches constant command", canonical: "y=π", student: "y=\\pi", expected: true },
);
const rawEngine = new ComputeEngine();
assert.equal(rawEngine.parse("\\nu=\\frac{N}{t}").isValid, false);
assert.equal(rawEngine.parse("F_{упр}").sub(rawEngine.parse("kx")).simplify().json, "NaN");
for (const latex of ["\\nu=\\frac{N}{t}", "F_{\\text{упр}}=kx", "v_{0}=at", "x=\\sqrt{y}"]) assert.equal(validateLatex(latex).length, 0);
assert.equal(convertLatexToMathMl("ν=N/t"), convertLatexToMathMl("\\nu=N/t"));
assert.equal(normalizeFormulaLatex("F_{упр}=kx"), normalizeFormulaLatex("F_{\\text{упр}}=kx"));

let failures = 0;
for (const testCase of cases) {
  const result = checkFormulaAnswer({
    studentExpression: testCase.student,
    canonicalExpression: testCase.canonical,
    alternativeExpressions: testCase.alternatives,
  });
  const passed = result.correct === testCase.expected && (!testCase.reason || result.reason === testCase.reason);
  if (!passed) failures += 1;
  console.log(`${passed ? "PASS" : "FAIL"} ${testCase.name}: ${result.correct} (${result.reason})`);
}

// Execute the actual Server Action with mocked IO, including the no-mutation
// path for parser failures. No production database reads or writes are made.
let runtimeChecks = 0;
const actionSource = readFileSync("src/app/student/trainers/formula-recall/actions.ts", "utf8");
const compiled = ts.transpileModule(actionSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let fixture = { state: "AWAITING_ANSWER", canonical_expression_snapshot: "ν=N/t", alternative_expressions_snapshot: [] as string[] };
const mutations: Array<{ p_is_correct: boolean }> = [];
const db = {
  from() { const query = { select: () => query, eq: () => query, neq: () => query, maybeSingle: async () => ({ data: fixture, error: null }) }; return query; },
  async rpc(_name: string, payload: { p_is_correct: boolean }) { mutations.push(payload); const hinted = fixture.state === "RETRY_AFTER_HINT"; return { error: null, data: { status: payload.p_is_correct ? "correct" : "revealed", state: hinted ? "CORRECT_HINTED" : "CORRECT_CLEAN", credit_awarded: payload.p_is_correct && !hinted } }; },
};
const actionModule = { exports: {} as { submitFormulaRecallAnswer: (id: string, value: string) => Promise<{ ok: boolean; status: string }> } };
const modules: Record<string, unknown> = {
  "@/lib/auth/get-current-profile": { getCurrentProfile: async () => ({ profile: { role: "STUDENT", student_status: "ACTIVE", id: "student" } }) },
  "@/lib/formula-recall/formula-checker": { checkFormulaAnswer },
  "@/lib/supabase/admin": { createAdminClient: () => db },
  "@/lib/formula-recall/runtime-data": { loadFormulaRecallTask: async () => ({ id: "task" }), loadFormulaRecallSummary: async () => ({ summary: {} }) },
};
const accessModule = { exports: {} };
const accessCode = ts.transpileModule(readFileSync("src/lib/trainers/student-access.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInThisContext(`(function(require,module,exports){${accessCode}\n})`)((name: string) => { assert.ok(Object.hasOwn(modules, name)); return modules[name]; }, accessModule, accessModule.exports);
modules["@/lib/trainers/student-access"] = accessModule.exports;
vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`)((name: string) => { assert.ok(Object.hasOwn(modules, name)); return modules[name]; }, actionModule, actionModule.exports);
for (const sample of [
  { name: "nu correct reaches RPC", canonical: "ν=N/t", alternatives: [], student: "\\nu=\\frac{N}{t}", status: "correct_clean", mutation: true },
  { name: "alternative snapshot reaches checker", canonical: "F=ma", alternatives: ["ν=N/t"], student: "\\nu=N/t", status: "correct_clean", mutation: true },
  { name: "truly wrong still reveals", canonical: "ν=N/t", alternatives: [], student: "\\nu=t/N", status: "revealed", mutation: false },
  { name: "invalid canonical never changes runtime", canonical: "\\frac{", alternatives: [], student: "F=ma", status: "error", mutation: null },
  { name: "student parse failure never changes runtime", canonical: "F=ma", alternatives: [], student: "\\frac{", status: "error", mutation: null },
  { name: "hinted correct remains hinted", canonical: "ν=N/t", alternatives: [], student: "\\nu=N/t", status: "correct_hinted", mutation: true, hinted: true },
]) {
  fixture = { state: sample.hinted ? "RETRY_AFTER_HINT" : "AWAITING_ANSWER", canonical_expression_snapshot: sample.canonical, alternative_expressions_snapshot: sample.alternatives };
  mutations.length = 0;
  const result = await actionModule.exports.submitFormulaRecallAnswer("11111111-1111-4111-8111-111111111111", sample.student);
  assert.equal(result.status, sample.status, sample.name);
  assert.equal(mutations.length, sample.mutation === null ? 0 : 1, sample.name);
  if (sample.mutation !== null) assert.equal(mutations[0].p_is_correct, sample.mutation, sample.name);
  runtimeChecks++; console.log(`PASS runtime: ${sample.name}`);
}
const sql = readFileSync("supabase/20260903-formula-recall-student-runtime.sql", "utf8");
assert.match(sql, /jsonb_agg\(a.expression order by a.sort_order\)/);
assert.match(sql, /picked_formula.canonical_expression,alternatives_value/);
const admin = readFileSync("src/app/admin/trainers/formula-recall/actions.ts", "utf8");
assert.match(admin, /p_alternatives: normalized\.alternatives/);
assert.match(admin, /alternativeExpressions:.*map\(/);
runtimeChecks++; console.log("PASS pipeline: canonical and alternatives persisted/snapshotted independently");

if (failures) {
  console.error(`Formula checker harness failed: ${failures}/${cases.length + runtimeChecks}`);
  process.exitCode = 1;
} else {
  console.log(`Formula checker harness passed: ${cases.length + runtimeChecks}/${cases.length + runtimeChecks} (${cases.length} formula cases + ${runtimeChecks} runtime/pipeline checks).`);
}
