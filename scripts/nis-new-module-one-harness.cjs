/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS hook transpiles only the tested TypeScript modules. */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
const katex = require('katex');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const { nisNewTemplates, generateNisNewTasks, NIS_NEW_TEMPLATE_COUNTS } = require('../src/lib/programs/nis-new-module-one.ts');
const { normalizeStrictSkillAnswer: check, INVALID_FORMAT } = require('../src/lib/programs/skill-answer-policy.ts');

// Independent exact parser: evaluate the displayed expression, not generator parameters.
function r(n, d = 1n) {
  n = BigInt(n); d = BigInt(d); assert.notEqual(d, 0n);
  if (d < 0n) { n = -n; d = -d; }
  let a = n < 0n ? -n : n, b = d;
  while (b) [a, b] = [b, a % b];
  a ||= 1n; return [n / a, d / a];
}
const canonical = ([n, d]) => d === 1n ? String(n) : `${n}/${d}`;
const plus = (a, b) => r(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
const times = (a, b) => r(a[0] * b[0], a[1] * b[1]);
function evalMath(latex) {
  const source = latex.replaceAll('{,}', '.').replaceAll(',', '.').replace(/(\d)(\\frac)/g, '$1+$2')
    .replace(/\\frac\{(-?\d+)\}\{(\d+)\}/g, '($1/$2)').replaceAll('\\cdot', '*').replaceAll('\\div', '/')
    .replaceAll('[', '(').replaceAll(']', ')').replace(/[{}]/g, '').replace(/\s/g, '');
  const tokens = source.match(/\d+(?:\.\d+)?|[()+\-*/^|]/g) || [];
  assert.equal(tokens.join(''), source, `Unsupported oracle input: ${latex}`);
  let i = 0;
  function atom() {
    const t = tokens[i++];
    if (t === '-') { const a = atom(); return [-a[0], a[1]]; }
    if (t === '+') return atom();
    if (t === '(') { const a = sum(); assert.equal(tokens[i++], ')'); return a; }
    if (t === '|') { const a = sum(); assert.equal(tokens[i++], '|'); return [a[0] < 0n ? -a[0] : a[0], a[1]]; }
    assert.match(t ?? '', /^\d/);
    const [whole, fraction = ''] = t.split('.'); return r(whole + fraction, 10n ** BigInt(fraction.length));
  }
  function power() { let a = atom(); if (tokens[i] === '^') { i++; const b = power(); assert.equal(b[1], 1n); a = r(a[0] ** b[0], a[1] ** b[0]); } return a; }
  function product() { let a = power(); while (['*', '/'].includes(tokens[i])) { const op = tokens[i++], b = power(); a = times(a, op === '/' ? r(b[1], b[0]) : b); } return a; }
  function sum() { let a = product(); while (['+', '-'].includes(tokens[i])) { const op = tokens[i++], b = product(); a = plus(a, op === '-' ? [-b[0], b[1]] : b); } return a; }
  const answer = sum(); assert.equal(i, tokens.length, latex); return canonical(answer);
}
const params = kind => ({ answer_kind: kind, answer_policy_version: 2, require_reduced: true });
assert.equal(check('0,4', params('decimal')), '2/5');
assert.equal(check('0.4', params('decimal')), '2/5');
assert.equal(check('2/5', params('decimal')), INVALID_FORMAT);
assert.equal(check('0,4', params('fraction')), INVALID_FORMAT);
assert.equal(check('4/10', params('fraction')), INVALID_FORMAT);
assert.equal(check('2/5', params('fraction')), '2/5');
assert.equal(check('1 2/5', params('mixed')), '7/5');
for (const bad of ['7/5', '1,4', '1 4/10', '0 7/5', '1 0/5', '1 2/0', '1 5/2']) assert.equal(check(bad, params('mixed')), INVALID_FORMAT);
assert.equal(check('-1 2/5', params('mixed')), '-7/5');
assert.equal(check('2; 1', params('sequence')), '2;1');
assert.equal(check('1, 2, 3', params('sequence')), INVALID_FORMAT);
assert.equal(check('-3 < 0 < 4', params('inequality')), '-3<0<4');
assert.equal(check('3^4', params('power')), '3^4');
assert.equal(check('81', params('power')), INVALID_FORMAT);
assert.equal(check('2/0', params('fraction')), INVALID_FORMAT);
assert.equal(check('1e3', params('number')), INVALID_FORMAT);
assert.equal(check('9'.repeat(101), params('number')), null);
assert.equal(check('', params('number')), null);
assert.equal(check('1,00', { ...params('decimal'), no_trailing_zeros: true }), INVALID_FORMAT);
assert.equal(check('1', { ...params('decimal'), decimal_places: 2 }), INVALID_FORMAT);
assert.equal(check('1,00', { ...params('decimal'), decimal_places: 2 }), '1');

let generated = 0, independent = 0;
const seen = new Map();
for (let round = 0; round < 100; round++) for (let skill = 1; skill <= 14; skill++) {
  const tasks = generateNisNewTasks(`nis_new_s1_${skill}_v2`);
  assert.equal(tasks.length, Math.max(12, NIS_NEW_TEMPLATE_COUNTS[skill]));
  assert.ok(tasks.length <= (skill === 1 ? 31 : 20));
  assert.equal(new Set(tasks.map(t => t.prompt)).size, tasks.length);
  assert.equal(new Set(tasks.map(t => t.parameters.template)).size, nisNewTemplates(skill).length);
  for (const t of tasks) {
    generated++;
    assert.ok(t.prompt.length <= 500 && t.expectedAnswer.length <= 100);
    assert.equal(check(t.parameters.answer_display, t.parameters), t.expectedAnswer, JSON.stringify(t));
    const math = [...t.prompt.matchAll(/\$([^$]+)\$/g)].map(m => m[1]);
    assert.ok(math.length);
    for (const expression of math) katex.renderToString(expression, { throwOnError: true, strict: 'error', trust: false });
    const subtype = Number(t.parameters.template.split('-').at(-1));
    const key = t.parameters.template;
    if (!seen.has(key)) seen.set(key, new Set()); seen.get(key).add(t.prompt);
    let expected;
    if (t.parameters.comparison_left) {
      const a=evalMath(t.parameters.comparison_left).split('/').map(Number),b=evalMath(t.parameters.comparison_right).split('/').map(Number);
      expected=String(Math.sign(a[0]*(b[1]||1)-b[0]*(a[1]||1)));
    } else if (t.prompt.startsWith('Вычислите') || skill === 10 || (skill === 8 && subtype === 9)) {
      expected = evalMath(math[0]);
    } else if (t.prompt.includes('Найдите') && math.some(x => x.includes('='))) {
      const equation = math.find(x => x.includes('=')).replace(/\b[xn]\b/g, `(${t.expectedAnswer})`);
      const [left, right] = equation.split('='); assert.equal(evalMath(left), evalMath(right), t.prompt); independent++;
    } else if (skill === 7 && subtype === 4) {
      assert.equal(evalMath(math[1]), evalMath(t.expectedAnswer)); independent++;
    } else if (skill === 11) {
      const m = math[0].match(/^(\d+)\{,\}(\d*)\\overline\{(\d+)\}$/);
      assert.ok(m);
      const integer = r(m[1]), nonperiod = r(m[2] || '0', 10n ** BigInt(m[2].length));
      const period = r(m[3], (10n ** BigInt(m[3].length) - 1n) * 10n ** BigInt(m[2].length));
      expected = canonical(plus(integer, plus(nonperiod, period)));
    } else if (skill === 13) {
      const value = Number(math[0].replaceAll('{,}', '.'));
      const factor = t.parameters.rounding_factor || (subtype <= 3 ? 10 ** -subtype : subtype <= 6 ? 10 ** (subtype - 4) : subtype === 7 ? 10 : 100);
      const got = evalMath(t.expectedAnswer).split('/').map(Number); const actual = got[0] / (got[1] || 1);
      assert.ok(Math.abs(actual - Math.round((value + Number.EPSILON * value) * factor) / factor) < 1e-8, t.prompt); independent++;
    }
    if (expected !== undefined) { assert.equal(expected, t.expectedAnswer, t.prompt); independent++; }
    if (t.parameters.answer_kind === 'decimal' && t.expectedAnswer.includes('/')) assert.equal(check(t.expectedAnswer, t.parameters), INVALID_FORMAT);
    if (t.parameters.answer_kind === 'mixed') assert.equal(check(t.expectedAnswer, t.parameters), INVALID_FORMAT);
  }
}
for (const [key, prompts] of seen) assert.ok(prompts.size >= 3, `${key} does not vary`);
console.log(JSON.stringify({ generated, independentMathChecks: independent, mandatorySubtypes: seen.size, counts: NIS_NEW_TEMPLATE_COUNTS, answerPolicy: 'passed', latex: 'passed' }, null, 2));
