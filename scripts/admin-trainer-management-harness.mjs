// Safe QA: render actual components and exercise actual actions with mocked IO.
// SQL is inspected, never applied. Browser interactions and PostgreSQL need runtime QA.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const requireModule = createRequire(import.meta.url);
const root = process.cwd();
let role = 'ADMIN', studentExists = true, rpcError = false;
const calls = [], refreshed = [];
const db = {
  from() { const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: studentExists ? { id: 'student' } : null, error: null }) }; return query; },
  async rpc(name, payload) { calls.push({ name, payload }); return { data: { status: name.startsWith('unassign') ? 'unassigned' : 'assigned', inserted: 3 }, error: rpcError ? { message: 'failure' } : null }; },
};
const mocks = {
  '@/lib/auth/get-current-profile': { getCurrentProfile: async () => ({ profile: { role, id: '11111111-1111-4111-8111-111111111111' } }) },
  '@/lib/supabase/admin': { createAdminClient: () => db },
  'next/cache': { revalidatePath: (value) => refreshed.push(value) },
  'next/navigation': { useRouter: () => ({ refresh() {} }) },
  'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
  '@/components/tests/math-text': { __esModule: true, default: ({ children }) => React.createElement('span', null, children) },
};
const cache = new Map();
function load(filename) {
  const absolute = path.resolve(root, filename);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const loadedModule = { exports: {} }; cache.set(absolute, loadedModule);
  const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const localRequire = (name) => {
    if (mocks[name]) return mocks[name];
    if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (name.startsWith('.') || name.startsWith('@/')) {
      const base = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(absolute), name);
      const resolved = [base, base + '.ts', base + '.tsx'].find((file) => fs.existsSync(file) && fs.statSync(file).isFile());
      assert.ok(resolved, name); return load(resolved);
    }
    return requireModule(name);
  };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: absolute })(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
const student = '22222222-2222-4222-8222-222222222222';
const ids = [1, 2, 3].map((i) => `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`);
const actions = load('src/app/admin/students/[id]/trainer-actions.ts');
const formulas = load('src/app/admin/students/[id]/formula-recall-actions.ts');
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
async function main() {
  for (const type of ['QUICK_PROBLEMS', 'THEORY']) await check(type + ': three selections use one batch RPC with explicit type', async () => {
    calls.length = 0; assert.equal((await actions.assignTrainers(student, type, ids)).ok, true);
    assert.equal(calls.length, 1); assert.equal(calls[0].name, 'assign_trainers_batch_atomic');
    assert.deepEqual(calls[0].payload.p_trainer_ids, ids); assert.equal(calls[0].payload.p_trainer_type, type);
  });
  await check('forged trainer type and malformed IDs rejected before RPC', async () => {
    calls.length = 0;
    for (const [type, values] of [['OTHER', ids], ['THEORY', null], ['THEORY', ['bad']], ['THEORY', []]]) assert.equal((await actions.assignTrainers(student, type, values)).ok, false);
    assert.equal(calls.length, 0);
  });
  await check('ADMIN and existing student required for every batch action', async () => {
    for (const denied of ['role', 'student']) {
      role = denied === 'role' ? 'STUDENT' : 'ADMIN'; studentExists = denied !== 'student'; calls.length = 0;
      assert.equal((await actions.assignTrainers(student, 'THEORY', ids)).ok, false);
      assert.equal((await formulas.assignFormulaRecallFormulas(student, ids)).ok, false);
      assert.equal((await formulas.unassignFormulaRecallFormulas(student, ids)).ok, false);
      assert.equal(calls.length, 0);
    }
    role = 'ADMIN'; studentExists = true;
  });
  await check('formula bulk assign reuses canonical atomic RPC; deduplicates payload', async () => {
    calls.length = 0; assert.equal((await formulas.assignFormulaRecallFormulas(student, [...ids, ids[0]])).ok, true);
    assert.equal(calls.length, 1); assert.equal(calls[0].name, 'assign_formula_recall_formulas_atomic'); assert.deepEqual(calls[0].payload.p_formula_ids, ids);
  });
  for (const count of [1, 3]) await check('formula unassign ' + count + ' uses one student-scoped RPC', async () => {
    calls.length = 0; assert.equal((await formulas.unassignFormulaRecallFormulas(student, ids.slice(0, count))).ok, true);
    assert.equal(calls.length, 1); assert.equal(calls[0].payload.p_student_id, student); assert.equal(calls[0].payload.p_assignment_ids.length, count);
  });
  await check('server errors produce failure without success refresh', async () => {
    rpcError = true; refreshed.length = 0;
    assert.equal((await actions.assignTrainers(student, 'THEORY', ids)).ok, false);
    assert.equal((await formulas.unassignFormulaRecallFormulas(student, ids)).ok, false);
    assert.equal(refreshed.length, 0); rpcError = false;
  });
  const Panel = load('src/components/students/student-trainers-panel.tsx').default;
  for (const count of [0, 3, 100]) await check('Quick/Theory initial render: ' + count + ' items per type, collapsed and separated', () => {
    const cards = ['QUICK_PROBLEMS', 'THEORY'].flatMap((type) => Array.from({ length: count }, (_, i) => ({ kind: 'ACTIVE', type, assignmentId: type+i, trainerId: type+i, groupId: null, title: type+i, skillsCount: 2, creditedCorrect: 1, progressPercent: 10 })));
    const html = render(Panel, { studentId: student, cards, available: [], groups: [] });
    assert.equal((html.match(/aria-expanded="false"/g) || []).length, 2);
    assert.equal((html.match(/hidden=""/g) || []).length, 2);
    assert.equal((html.match(/Удалить назначение/g) || []).length, count*2);
    assert.equal((html.match(/Сбросить прогресс/g) || []).length, count);
    assert.ok(html.includes(count + ' назначено'));
  });
  const UI = load('src/components/students/trainer-management-ui.tsx');
  await check('assignment modal renders disabled assigned item, checkboxes, select all, no search', () => {
    const html = render(UI.AssignmentModal, { title: 'Quick Problems', close() {}, action: async () => ({ok:true,message:''}), groups: [{id:'topic',title:'Topic',items:[{id:'a',content:'A'},{id:'b',content:'B',disabledLabel:'Уже назначен'}]}] });
    assert.ok(html.includes('Уже назначен')); assert.ok(html.includes('Выбрать все')); assert.ok(html.includes('Назначить 0'));
    assert.equal((html.match(/type="checkbox"/g) || []).length, 3); assert.doesNotMatch(html, /type="search"/);
    assert.match(html, /disabled="" checked=""/);
  });
  await check('formula assigned list renders one checkbox per assignment plus select-all', () => {
    const Formula = load('src/components/students/formula-recall-assignments-panel.tsx').default;
    const html = render(Formula, { studentId: student, topics: [{id:'topic',title:'Topic',formulas:ids.map((id) => ({assignmentId:id,formulaId:id,expression:'x=1',cleanRecallCount:2}))}], summary:{assignedCount:3} });
    assert.equal((html.match(/type="checkbox"/g) || []).length, 4); assert.ok(html.includes('3 формул назначено'));
  });
  await check('Mistake Review count, route and no assignment control', () => {
    const Card = load('src/components/students/student-mistakes-card.tsx').default;
    const html = render(Card, { studentId:student,count:2,corrected:14 });
    assert.ok(html.includes('2 активных ошибок · 14 исправлено')); assert.ok(html.includes(`/admin/students/${student}/mistakes`)); assert.ok(!html.includes('Назначить'));
  });
  const sql = fs.readFileSync('supabase/20260906-trainer-admin-batch-assignments.sql','utf8');
  await check('batch SQL has typed owner validation and rollback on rejected member', () => {
    assert.match(sql, /and type=p_trainer_type/); assert.match(sql, /owner_admin_id=p_owner_admin_id/);
    assert.match(sql, /public.assign_trainer_atomic\(p_owner_admin_id,p_student_id,trainer_id\)/);
    assert.match(sql, /raise exception.*[\s\S]*TRAINER_BATCH_REJECTED/); assert.doesNotMatch(sql, /exception when/i);
    assert.match(sql, /order by id loop/); assert.match(sql, /'already_assigned'/);
  });
  await check('bulk formula deletion preserves scoped DELETE and legacy lock order', () => {
    const unassign = sql.slice(sql.indexOf('create function public.unassign_formula'));
    const positions = [':formula-recall-runtime', 'perform 1 from public.formula_recall_formulas', 'perform 1 from public.formula_recall_student_formulas', 'perform 1 from public.formula_recall_tasks', 'perform 1 from public.formula_recall_retries', 'delete from public.formula_recall_student_formulas'].map((part) => unassign.indexOf(part));
    assert.ok(positions.every((position, i) => position >= 0 && (i === 0 || position > positions[i-1])));
    assert.match(unassign, /delete from public.formula_recall_student_formulas where id=any\(p_assignment_ids\)\s+and student_id=p_student_id and owner_admin_id=p_owner_admin_id/);
    assert.match(sql, /from public,anon,authenticated/); assert.match(sql, /to service_role/);
  });
  await check('pending guard, controlled errors, confirmation and responsive internal scroll are wired', () => {
    const ui = fs.readFileSync('src/components/students/trainer-management-ui.tsx','utf8');
    const formula = fs.readFileSync('src/components/students/formula-recall-assignments-panel.tsx','utf8');
    const css = fs.readFileSync('src/components/students/trainer-management.module.css','utf8');
    assert.match(ui, /if \(busy.current\) return/); assert.match(ui, /catch \{/); assert.match(ui, /router.refresh\(\)/);
    assert.match(formula, /Отменить назначение/); assert.match(formula, /Прогресс и история/);
    assert.match(css, /max-width:600px/); assert.match(css, /modalBody\{overflow:auto/);
  });
  await check('applied SQL and runtimes outside the authorized Formula checker fix remain unchanged', () => {
    const baseline='4b8621bc8d11d4c2f0317166bb9b56ed46e8c862';
    const files=execFileSync('git',['ls-tree','-r','--name-only',baseline,'supabase','src/app/student','src/components/student','src/lib/tests','src/lib/formula-recall','src/lib/mistakes'],{encoding:'utf8'}).trim().split(/\r?\n/);
    // Subsequent Formula checker audit explicitly authorizes these three files.
    // Keep the original immutability check for every other runtime and SQL file.
    const checkerAuditFiles = new Set(['src/lib/formula-recall/formula-checker.ts', 'src/app/student/trainers/formula-recall/actions.ts', 'src/app/student/trainers/formula-recall/formula-recall.module.css']);
    // AUDIT-02 changes only access enforcement and inactive UI in these runtimes.
    const activeStudentFiles = new Set([
      'src/app/student/trainers/[assignmentId]/actions.ts',
      'src/app/student/trainers/[assignmentId]/page.tsx',
      'src/app/student/trainers/[assignmentId]/quick-problems-runner.tsx',
      'src/app/student/trainers/[assignmentId]/theory-runner.tsx',
      'src/app/student/trainers/formula-recall/practice/formula-recall-practice.tsx',
    ]);
    const batch1UiFiles = new Set(['src/components/student/tests/intent-prefetch-link.tsx']);
    const formulaBatchCreateFiles = new Set([
      'src/lib/formula-recall/data.ts',
      'src/lib/formula-recall/types.ts',
    ]);
    for (const file of files) if (!checkerAuditFiles.has(file) && !activeStudentFiles.has(file) && !batch1UiFiles.has(file) && !formulaBatchCreateFiles.has(file)) assert.deepEqual(fs.readFileSync(file),execFileSync('git',['show',`${baseline}:${file}`]),file);
  });
  console.log(`Admin trainer management: ${passed} checks passed; no SQL applied, no browser clicks simulated.`);
}
main().catch((error) => { console.error(error); process.exitCode=1; });
