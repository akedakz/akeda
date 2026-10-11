/* eslint-disable @typescript-eslint/no-require-imports -- Test-only CommonJS TypeScript loader. */
const fs = require('node:fs');
const ts = require('typescript');
const assert = require('node:assert/strict');
const katex = require('katex');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const { generateNisTwoTasks, NIS_TWO_TEMPLATE_COUNTS } = require('../src/lib/programs/nis-new-module-two.ts');
const { normalizeStrictSkillAnswer: normalize, INVALID_FORMAT } = require('../src/lib/programs/skill-answer-policy.ts');
function divisors(n) { const out = []; for (let d = 1; d * d <= n; d++) if (n % d === 0) { out.push(d); if (d * d !== n) out.push(n / d); } return out.sort((a,b) => a-b); }
const prime = n => n > 1 && divisors(n).length === 2;
const greatest = numbers => Math.max(...divisors(Math.min(...numbers)).filter(d => numbers.every(n => n % d === 0)));
function least(numbers) { const step = Math.max(...numbers); let n = step; while (!numbers.every(d => n % d === 0)) n += step; return n; }
const interval = (lo, hi) => Array.from({length: hi-lo+1}, (_,i) => lo+i);
function lastPower(base, exponent) {
  // Independent cycle enumeration, rather than the generator's binary exponentiation.
  const seen = new Map(), values = []; let current = base % 10;
  while (!seen.has(current)) { seen.set(current, values.length); values.push(current); current = current * (base % 10) % 10; }
  const start = seen.get(current), length = values.length - start;
  const index = exponent-1 < values.length ? exponent-1 : start + (exponent-1-start) % length;
  return values[index];
}
function select(values, mode) { return mode === 'count' ? values.length : mode === 'min' ? values[0] : mode === 'max' ? values.at(-1) : values.join(';'); }
function oracle({op,args:a,mode}) {
  switch(op) {
    case 'exclusive_multiples': return interval(a[0],a[1]).filter(n=>n%a[2]===0&&n%a[3]!==0).length;
    case 'prime_divisor_count': return divisors(a[0]).filter(prime).length;
    case 'division_divisor': { const d=(a[0]-a[2])/a[1]; assert.equal(d,Math.floor(d)); assert.ok(a[2]<d); return d; }
    case 'boxes': { let boxes=0; while(boxes*a[1]<a[0]) boxes++; return boxes; }
    case 'last_digit_fill': return interval(0,9).filter(d=>Number(String(a[0])+d)%a[1]===0).join(';');
    case 'divisors': return divisors(a[0]).join(';');
    case 'multiples': return select(interval(a[1],a[2]).filter(n => n%a[0]===0),mode);
    case 'divisible': return Number(a[0]%a[1]===0);
    case 'divisible_all': return Number(a.slice(1).every(d => a[0]%d===0));
    case 'neither': return a.find(n=>n===1);
    case 'prime': return Number(prime(a[0]));
    case 'prime_divisors': return divisors(a[0]).filter(prime).join(';');
    case 'factorization': return a[0];
    case 'product_powers': { let n=1n; for(let i=0;i<a.length;i+=2) n*=BigInt(a[i])**BigInt(a[i+1]); return String(n); }
    case 'missing_factor': assert.equal(a[0]%a[1],0); return a[0]/a[1];
    case 'parity': return a[0]%2;
    case 'parity_sum': return (a[0]+a[1])%2;
    case 'parity_difference': return (a[0]-a[1])%2;
    case 'parity_product': return a[0]*a[1]%2;
    case 'digit_sum': return Array.from(String(a[0]),Number).reduce((x,y)=>x+y,0);
    case 'gcd': return greatest(a);
    case 'coprime': return Number(greatest(a)===1);
    case 'gcd_search': return interval(a[2],a[3]).find(n => greatest([a[0],n])===a[1]);
    case 'lcm': return least(a);
    case 'next_multiple': return interval(a[2]+1,a[2]+least(a.slice(0,2))).find(n => n%a[0]===0 && n%a[1]===0);
    case 'division': return `${(BigInt(a[0])/BigInt(a[1])).toString()};${a[0]%a[1]}`;
    case 'dividend': return String(BigInt(a[0])*BigInt(a[1])+BigInt(a[2]));
    case 'valid_remainder': return Number(a[1]>=0 && a[1]<a[0]);
    case 'residues': return select(interval(a[0],a[1]).filter(n => n%a[2]===a[3] && n%a[4]===a[5]),mode);
    case 'digits': { const digits=interval(a[2]?1:0,9).filter(d => a.slice(3).every(k => Number(a[2]?`${d}${a[0]}${a[1]}`:`${a[0]}${d}${a[1]}`)%k===0)); assert.ok(digits.length); return select(digits,mode); }
    case 'last_power': return lastPower(...a);
    case 'remainder': return a[0]%a[1];
    case 'power_cycle': return interval(1,4).map(e => lastPower(a[0],e)).join(';');
    case 'last_product': return String(a.reduce((n,v)=>n*BigInt(v),1n)%10n);
    case 'last_power_product': return lastPower(a[0],a[1])*lastPower(a[2],a[3])%10;
    case 'last_sum_products': return String((BigInt(a[0])*BigInt(a[1])+BigInt(a[2])*BigInt(a[3]))%10n);
    case 'last_difference_products': { const n=BigInt(a[0])*BigInt(a[1])-BigInt(a[2])*BigInt(a[3]); assert.ok(n>=0n); return String(n%10n); }
    case 'last_power_sum': return (lastPower(a[0],a[1])+lastPower(a[2],a[3]))%10;
    case 'divisor_count': return divisors(a[0]).length;
    case 'prime_power_count': return divisors(a[0]**a[1]).length;
    case 'coprime_product_count': assert.equal(greatest(a),1); return divisors(a[0]*a[1]).length;
    case 'missing_exponent': return interval(1,10).find(e => divisors(2**e * a[0]**a[1]).length===a[2]);
    default: throw new Error(`Missing oracle: ${op}`);
  }
}
const factorParams={answer_kind:'factorization',answer_policy_version:2};
for(const s of ['2^3*3','3 * 2 * 2 * 2','2³*3'.replace('³','^3'),'2^3 × 3','2^3 · 3']) assert.equal(normalize(s,factorParams),'24');
for(const s of ['24','4*6','1*2^3*3','2^0*24','2^21','0','2/3','2.0*3','2^-1','2^1.5','2**3','1000000007','2^999999999999999','2^3+3']) assert.equal(normalize(s,factorParams),INVALID_FORMAT,s);
assert.equal(normalize('7',factorParams),'7');
const listParams={answer_kind:'integer_list'};
assert.equal(normalize('0',listParams),'0');
assert.equal(normalize('1; 2; 4; 8',listParams),'1;2;4;8');
for(const s of ['1;2.0','1;4/2','1,2','1;;2',';1','1;']) assert.equal(normalize(s,listParams),INVALID_FORMAT);
assert.equal(normalize('2/5',{answer_kind:'decimal'}),INVALID_FORMAT);
assert.equal(normalize('0,4',{answer_kind:'decimal'}),'2/5');
assert.equal(normalize('2.0',{answer_kind:'integer'}),INVALID_FORMAT);
assert.equal(normalize('9'.repeat(101),factorParams),null);
let total=0;
const variants=new Map();
const divisibilityOutcomes=new Map();
for(let round=0;round<200;round++) for(let skill=1;skill<=11;skill++) {
  const tasks=generateNisTwoTasks(`nis_new_s2_${skill}_v2`);
  assert.equal(tasks.length,Math.max(12,NIS_TWO_TEMPLATE_COUNTS[skill]));
  assert.ok(tasks.length<=20);
  assert.equal(new Set(tasks.map(t=>t.parameters.template)).size,NIS_TWO_TEMPLATE_COUNTS[skill]);
  assert.equal(new Set(tasks.map(t=>t.prompt)).size,tasks.length);
  if(skill===3) {
    const checks=tasks.map(t=>JSON.parse(t.parameters.check_case));
    assert.deepEqual([...new Set(checks.filter(c=>c.op==='divisible').map(c=>c.args[1]))].sort((a,b)=>a-b),interval(2,10));
    assert.ok(checks.every(c=>['divisible','divisible_all','multiples'].includes(c.op)));
    for(const c of checks.filter(c=>c.op==='divisible')) {
      if(!divisibilityOutcomes.has(c.args[1])) divisibilityOutcomes.set(c.args[1],new Set());
      divisibilityOutcomes.get(c.args[1]).add(c.args[0]%c.args[1]===0);
    }
  }
  for(const t of tasks) {
    total++;
    assert.equal(String(oracle(JSON.parse(t.parameters.check_case))),t.expectedAnswer,t.prompt);
    assert.ok(t.prompt.length<=500 && t.expectedAnswer.length<=100,t.prompt);
    assert.equal(normalize(t.parameters.answer_display,t.parameters),t.expectedAnswer,JSON.stringify(t));
    const math=[...t.prompt.matchAll(/\$([^$]+)\$/g)]; assert.ok(math.length);
    for(const [,expression] of math) katex.renderToString(expression,{throwOnError:true,strict:'error',trust:false});
    if(!variants.has(t.parameters.template)) variants.set(t.parameters.template,new Set());
    variants.get(t.parameters.template).add(t.prompt);
    if(t.parameters.answer_kind==='factorization' && !prime(Number(t.expectedAnswer))) assert.equal(normalize(t.expectedAnswer,t.parameters),INVALID_FORMAT);
  }
}
for(const [key,values] of variants) assert.ok(values.size>=3,`${key}: no variation`);
for(const d of interval(2,10)) assert.equal(divisibilityOutcomes.get(d).size,2,`Divisibility by ${d}: both yes/no cases required`);
console.log(JSON.stringify({tasks:total,independentChecks:total,mandatorySubtypes:variants.size,counts:NIS_TWO_TEMPLATE_COUNTS,latex:'passed',strictForms:'passed'},null,2));
