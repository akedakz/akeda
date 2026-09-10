// AUDIT-02: real Server Actions/helpers with mocked session and database IO.
// SQL is reviewed as text; no database connection or migration apply occurs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { createHash, webcrypto } from 'node:crypto';
const require = createRequire(import.meta.url);
const baseline = 'cfdbbe1e41c12070477cb9559f614317fc3cac4a';
const student = '11111111-1111-4111-8111-111111111111';
const assignment = '22222222-2222-4222-8222-222222222222';
const task = '33333333-3333-4333-8333-333333333333';
let profile, rpcInactive, insertInactive;
const writes = [], reads = [], rpcCalls = [], refreshes = [];
const fixtures = {
  trainer_assignments: { id: assignment, trainer_id: task, owner_admin_id: 'admin' },
  trainers: { id: task, title: 'Quick', type: 'QUICK_PROBLEMS', content_revision: 1, definition: { skills: [{ key: 'speed', name: 'Speed', formulaLatex: 'v=s/t', variants: [{ key: 'one' }] }] } },
  trainer_assignment_skill_progress: [],
  trainer_quick_problem_tasks: { skill_key: 'speed', variant_key: 'one', prompt: 'old', consumed_at: 'now', result_correct: false, content_revision: 1 },
  formula_recall_tasks: { state: 'AWAITING_ANSWER', canonical_expression_snapshot: 'F=ma', alternative_expressions_snapshot: [] },
};
const db = {
  from(table) {
    const filters = [];
    const query = {
      select() { reads.push(table); return query; }, eq(key, value) { filters.push([key, value]); return query; },
      neq() { return query; }, order() { return query; }, limit() { return query; },
      maybeSingle: async () => ({ data: fixtures[table] ?? null, error: null }),
      then(resolve) { return Promise.resolve({ data: fixtures[table] ?? [], error: null }).then(resolve); },
      async insert(rows) {
        if (insertInactive) return { error: { code: 'PT403', message: 'student_inactive' } };
        writes.push({ table, rows, filters }); return { error: null };
      },
    }; return query;
  },
  async rpc(name, payload) {
    rpcCalls.push({ name, payload });
    if (rpcInactive) return { data: { status: 'student_inactive' }, error: null };
    writes.push({ name, payload });
    const status = name === 'issue_formula_recall_task_atomic' ? 'issued' : name === 'acknowledge_formula_recall_hint_atomic' ? 'acknowledged' : name === 'submit_formula_recall_answer_atomic' ? payload.p_is_correct ? 'correct' : 'revealed' : 'recorded';
    return { data: { status, task_id: task, state: 'CORRECT_CLEAN', credit_awarded: true, correct: true, mode: 'NORMAL', progress_percent: 20 }, error: null };
  },
};
const mocks = {
  '@/lib/auth/get-current-profile': { getCurrentProfile: async () => profile ? { profile } : null },
  '@/lib/supabase/admin': { createAdminClient: () => db },
  'next/cache': { revalidatePath: (p) => refreshes.push(p) },
  '@/lib/formula-recall/runtime-data': { loadFormulaRecallTask: async () => ({ id: task }), loadFormulaRecallSummary: async () => ({ summary: {} }) },
  './trainer-progress': { fingerprintTrainerSkill: () => 'fingerprint' },
  './trainer-import': { generateProblem: () => ({ prompt: 'Calculate', answer: 4, answerUnit: 'm' }) },
};
const cache = new Map();
function load(file, sourceOverride) {
  const absolute = path.resolve(file), key = sourceOverride ? absolute + ':baseline' : absolute;
  if (cache.has(key)) return cache.get(key).exports;
  const loadedModule = { exports: {} }; cache.set(key, loadedModule);
  const code = ts.transpileModule(sourceOverride ?? fs.readFileSync(absolute, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const localRequire = (name) => {
    if (mocks[name]) return mocks[name];
    if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts');
    if (name.startsWith('.')) return load(path.resolve(path.dirname(absolute), name + '.ts'));
    return require(name);
  };
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})')(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const quick = load('src/app/student/trainers/[assignmentId]/actions.ts');
const formula = load('src/app/student/trainers/formula-recall/actions.ts');
const access = load('src/lib/trainers/student-access.ts');
const operations = [
  ['Quick start/refill', () => quick.refillNormalTasks(assignment)],
  ['Quick hint/retry issuance', () => quick.refillHintTasks(assignment, task)],
  ['Quick answer/credit/completion', () => quick.recordQuickProblemAnswer(assignment, task, 4)],
  ['Theory answer/next/completion', () => quick.recordTheoryAnswer(assignment, task, 0)],
  ['Formula start', () => formula.getFormulaRecallTask(null)],
  ['Formula next', () => formula.getFormulaRecallTask(null, true)],
  ['Formula correct/mastery', () => formula.submitFormulaRecallAnswer(task, 'F=ma')],
  ['Formula wrong/reveal/retry', () => formula.submitFormulaRecallAnswer(task, 'F=m+a')],
  ['Formula remembered', () => formula.acknowledgeFormulaRecallHint(task)],
];
function reset(status = 'ACTIVE', role = 'STUDENT') {
  profile = { id: student, role, student_status: status };
  rpcInactive = false; insertInactive = false;
  for (const array of [writes, reads, rpcCalls, refreshes]) array.length = 0;
}
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
await check('baseline reproduction: PAUSED session reaches Quick/Theory/Formula writes', async () => {
  const qp = 'src/app/student/trainers/[assignmentId]/actions.ts', fp = 'src/app/student/trainers/formula-recall/actions.ts';
  const beforeQuick = load(qp, execFileSync('git', ['show', `${baseline}:${qp}`], { encoding: 'utf8' }));
  const beforeFormula = load(fp, execFileSync('git', ['show', `${baseline}:${fp}`], { encoding: 'utf8' }));
  reset('PAUSED');
  for (const run of [() => beforeQuick.recordQuickProblemAnswer(assignment, task, 4), () => beforeQuick.recordTheoryAnswer(assignment, task, 0), () => beforeFormula.submitFormulaRecallAnswer(task, 'F=ma')]) {
    assert.equal((await run()).ok, true);
  }
  assert.equal(writes.length, 3);
});
for (const [name, run] of operations) {
  await check(name + ': ACTIVE preserves successful path', async () => { reset(); assert.equal((await run()).ok, true); assert.ok(writes.length); });
  for (const status of ['PAUSED', 'ARCHIVED']) await check(name + ': ' + status + ' rejects before IO/progress/history', async () => {
    reset(status); const result = await run(); assert.equal(result.ok, false); assert.equal(result.status, 'student_inactive');
    assert.equal(result.message, access.TRAINER_INACTIVE_MESSAGE);
    assert.equal(writes.length, 0); assert.equal(reads.length, 0); assert.equal(refreshes.length, 0);
  });
  await check(name + ': DB rejection after ACTIVE session remains controlled', async () => {
    reset(); rpcInactive = true; insertInactive = true; const result = await run();
    assert.equal(result.ok, false); assert.equal(result.status, 'student_inactive'); assert.equal(result.message, access.TRAINER_INACTIVE_MESSAGE);
    assert.equal(writes.length, 0); assert.equal(refreshes.length, 0);
  });
}
await check('ACTIVE -> PAUSED: next request is rejected; prior write count unchanged', async () => {
  reset(); await quick.recordQuickProblemAnswer(assignment, task, 4); const count = writes.length;
  profile.student_status = 'PAUSED'; assert.equal((await quick.recordQuickProblemAnswer(assignment, task, 4)).status, 'student_inactive'); assert.equal(writes.length, count);
});
await check('client cannot choose student identity or supply active status', async () => {
  reset(); await quick.recordTheoryAnswer(assignment, task, 0, { student_id: 'victim', student_status: 'ACTIVE' });
  assert.equal(rpcCalls[0].payload.p_student_id, student);
  reset('PAUSED'); assert.equal((await formula.getFormulaRecallTask(null, false, { student_status: 'ACTIVE' })).status, 'student_inactive'); assert.equal(writes.length, 0);
});
await check('anonymous/non-STUDENT sessions and null status fail closed', async () => {
  for (const fixture of [null, { id: student, role: 'ADMIN', student_status: 'ACTIVE' }, { id: student, role: 'STUDENT', student_status: null }]) {
    reset(); profile = fixture; assert.equal((await quick.refillNormalTasks(assignment)).ok, false); assert.equal(writes.length, 0);
  }
});

const migrationPath = 'supabase/20260907-trainer-active-student-enforcement.sql';
const sql = fs.readFileSync(migrationPath, 'utf8');
const guard = "  if not public.lock_active_trainer_student(p_student_id) then return jsonb_build_object('status','student_inactive'); end if;\n";
const sources = [
  ['20260902-quick-problems-live-content.sql', 'record_quick_problem_answer_atomic'],
  ['20260830-theory-trainer-runtime.sql', 'record_theory_answer_atomic'],
  ['20260830-theory-runner-performance.sql', 'issue_theory_question_atomic'],
  ['20260830-theory-runner-performance.sql', 'record_theory_answer_and_issue_atomic'],
  ['20260903-formula-recall-student-runtime.sql', 'issue_formula_recall_task_atomic'],
  ['20260903-formula-recall-student-runtime.sql', 'submit_formula_recall_answer_atomic'],
  ['20260903-formula-recall-student-runtime.sql', 'acknowledge_formula_recall_hint_atomic'],
];
for (const [file, name] of sources) await check('SQL ' + name + ': guard precedes all work; remaining canonical body identical', () => {
  const re = new RegExp('create (?:or replace )?function public\\.' + name + '\\([\\s\\S]*?\\$\\$;');
  const prior = fs.readFileSync('supabase/' + file, 'utf8').replace(/\r\n/g, '\n').match(re)[0].replace(/^create (?:or replace )?function/, 'create or replace function');
  const current = sql.match(re)[0]; assert.ok(current.includes('\nbegin\n' + guard)); assert.equal(current.replace(guard, ''), prior);
  assert.match(sql, new RegExp('revoke all on function public\\.' + name)); assert.match(sql, new RegExp('grant execute on function public\\.' + name + '\\([^;]+to service_role;'));
});
await check('SQL profile SHARE serializes pause and stays compatible with assignment FK locks', () => {
  assert.match(sql, /where id=p_student_id and role='STUDENT' and student_status='ACTIVE' for share;/);
  assert.doesNotMatch(sql, /auth\.uid|current_setting|set_config/);
  assert.match(sql, /lock_active_trainer_student\(uuid\) from public,anon,authenticated,service_role/);
});
await check('SQL direct Quick INSERT uses stored assignment identity, BEFORE INSERT and transactional rejection', () => {
  assert.match(sql, /select student_id into student_id_value from public.trainer_assignments where id=new.assignment_id/);
  assert.match(sql, /before insert on public.trainer_quick_problem_tasks/);
  assert.match(sql, /raise exception using errcode='PT403', message='student_inactive'/);
});
await check('applied SQL, checker and runtimes outside authorized audits byte-identical to baseline', () => {
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', baseline, 'supabase', 'src/app/admin', 'src/lib/formula-recall', 'src/lib/mistakes', 'src/lib/tests', 'src/app/student/tests', 'src/app/student/trainers/mistakes', 'src/components/students'], { encoding: 'utf8' }).trim().split('\n');
  const authorizedAuditFiles = new Set([
    'src/app/admin/materials/material-library-explorer.tsx',
    'src/app/admin/payments/payments-tracker.tsx',
    'src/app/admin/settings/messages/messages-settings.tsx',
    'src/app/admin/settings/topic-templates/[templateId]/template-editor.tsx',
    'src/app/admin/tests/test-library-explorer.tsx',
    'src/app/admin/trainers/formula-recall/formula-recall-library.tsx',
    'src/app/admin/trainers/quick-problems/quick-problems-library.tsx',
    'src/app/admin/trainers/theory/theory-library.tsx',
    'src/components/students/student-page-tabs.tsx',
    'src/components/students/student-tabs.tsx',
    'src/components/students/student-tabs.module.css',
    'src/app/admin/students/[id]/page.tsx',
    'src/app/admin/students/[id]/student-tab-content.tsx',
    'src/app/admin/students/[id]/tests/[assignmentId]/attempts/[attemptId]/page.tsx',
    'src/app/admin/students/[id]/tests/[assignmentId]/page.tsx',
    'src/app/admin/tests/[id]/page.tsx',
    'src/app/admin/tests/[id]/preview/page.tsx',
    'src/app/admin/tests/import-actions.ts',
    'src/app/admin/tests/test-import-modal.tsx',
    'src/app/api/admin/material-library/route.ts',
    'src/app/admin/trainers/formula-recall/actions.ts',
    'src/app/admin/trainers/formula-recall/formula-editor-form.tsx',
    'src/app/admin/trainers/formula-recall/new/page.tsx',
    'src/lib/formula-recall/data.ts',
    'src/lib/formula-recall/types.ts',
  ]);
  for (const file of files) if (!authorizedAuditFiles.has(file)) assert.deepEqual(fs.readFileSync(file), execFileSync('git', ['show', `${baseline}:${file}`]), file);
  assert.equal((sql.match(/create or replace function/g) ?? []).length, 7);
});
// Execute real client event handlers with a small hook host and deferred IO.
// This does not emulate DOM layout or a physical browser.
function client(file, actionMocks) {
  const slots = [], effects = [], timers = [], storage = new Map(); let cursor = 0;
  const hooks = {
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], (next) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(value) { const i = cursor++; if (!(i in slots)) slots[i] = { current: value }; return slots[i]; },
    useEffect(fn) { const i = cursor++; if (!(i in slots)) { slots[i] = true; effects.push(fn); } },
    useCallback: (fn) => fn,
    useTransition: () => [false, (fn) => fn()],
  };
  const loadedModule = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const css = { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
  const localRequire = (name) => name === 'react' ? hooks : name.endsWith('/actions') ? actionMocks : name.endsWith('.css') ? css : name === 'next/navigation' ? { useRouter: () => ({ prefetch() {}, replace() {} }) } : name === 'next/link' || name.startsWith('@/components/') ? { __esModule: true, default: name } : require(name);
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', {
    crypto: webcrypto, TextEncoder, requestAnimationFrame() {},
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    window: { setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: (id) => { timers[id - 1] = null; } },
  })(localRequire, loadedModule, loadedModule.exports);
  return { render(props) { cursor = 0; return loadedModule.exports.default(props); }, async mount() { for (const fn of effects.splice(0)) fn(); await settle(); }, slots, timers, storage };
}
function nodes(node) { return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : []; }
const settle = () => new Promise((resolve) => setImmediate(resolve));
const packet = { id: task, prompt: 'Calculate', answerUnit: 'm', skillKey: 'speed', skillName: 'Speed', variantKey: 'one', contentRevision: 1, mode: 'NORMAL', formulaLatex: 'F=ma', answerSalt: 'salt', answerCommitment: createHash('sha256').update('salt:4').digest('hex') };
const quickProps = { initial: { snapshot: { assignmentId: assignment, trainerTitle: 'Quick', contentRevision: 1, skillsCount: 1, creditedBySkill: { speed: 0 }, progressPercent: 0, storageScope: 'test' }, bundles: [{ task: packet, retries: [] }] } };
await check('Quick UI waits for server; inactive is terminal with one request and no success/progress/timer', async () => {
  let resolve, calls = 0;
  const deferred = new Promise((done) => { resolve = done; });
  const ui = client('src/app/student/trainers/[assignmentId]/quick-problems-runner.tsx', { recordQuickProblemAnswer: () => { calls++; return deferred; } });
  ui.render(quickProps); await ui.mount();
  nodes(ui.render(quickProps)).find((n) => n.type === 'input').props.onChange({ target: { value: '4' } });
  await nodes(ui.render(quickProps)).find((n) => n.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(calls, 1); assert.equal(ui.slots[5], 0); assert.equal(ui.slots[3], null); assert.equal(ui.timers.length, 0);
  resolve(access.inactiveTrainerResult()); await settle();
  assert.equal(calls, 1); assert.equal(ui.slots[5], 0); assert.equal(ui.slots[3], null); assert.equal(ui.storage.size, 0);
  const denied = nodes(ui.render(quickProps)); assert.ok(denied.some((n) => n.props?.role === 'alert')); assert.ok(!denied.some((n) => n.type === 'form'));
});
await check('Quick ACTIVE UI displays only confirmed server progress', async () => {
  const ui = client('src/app/student/trainers/[assignmentId]/quick-problems-runner.tsx', { recordQuickProblemAnswer: async () => ({ ok: true, result: { status: 'recorded', correct: true, mode: 'NORMAL', credited_correct: 1, progress_percent: 20 } }) });
  ui.render(quickProps); await ui.mount(); nodes(ui.render(quickProps)).find((n) => n.type === 'input').props.onChange({ target: { value: '4' } });
  await nodes(ui.render(quickProps)).find((n) => n.type === 'form').props.onSubmit({ preventDefault() {} }); await settle();
  assert.equal(ui.slots[5], 20); assert.equal(ui.slots[3].tone, 'correct'); assert.equal(ui.timers.length, 1);
});
await check('Quick pending replay stops at first inactive result and does not refill or retry', async () => {
  let calls = 0;
  const ui = client('src/app/student/trainers/[assignmentId]/quick-problems-runner.tsx', { recordQuickProblemAnswer: async () => { calls++; return access.inactiveTrainerResult(); }, refillNormalTasks() { throw Error('Inactive replay must not refill'); } });
  ui.storage.set('nsp:quick-problems:pending:v1:test', JSON.stringify([task, student].map((id) => ({ assignmentId: assignment, taskId: id, submittedAnswer: 4, contentRevision: 1 }))));
  ui.render(quickProps); await ui.mount();
  assert.equal(calls, 1); assert.equal(ui.storage.size, 0); assert.ok(nodes(ui.render(quickProps)).some((n) => n.props?.role === 'alert'));
});
await check('Quick admin preview still works locally without RPC', async () => {
  const ui = client('src/app/student/trainers/[assignmentId]/quick-problems-runner.tsx', { recordQuickProblemAnswer() { throw Error('Preview must not mutate DB'); } });
  const props = { ...quickProps, previewMode: true }; ui.render(props); await ui.mount();
  nodes(ui.render(props)).find((n) => n.type === 'input').props.onChange({ target: { value: '4' } });
  await nodes(ui.render(props)).find((n) => n.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(ui.slots[5], 20); assert.equal(ui.slots[3].tone, 'correct');
});
await check('Theory UI inactive rejection disables choices and preserves progress/feedback', async () => {
  const ui = client('src/app/student/trainers/[assignmentId]/theory-runner.tsx', { recordTheoryAnswer: async () => access.inactiveTrainerResult() });
  const props = { initial: { assignmentId: assignment, title: 'Theory', progressPercent: 0, task: { id: task, text: 'Question', mastery: 0, options: ['A', 'B', 'C', 'D'] } } };
  nodes(ui.render(props)).find((n) => n.type === 'button').props.onClick(); await settle();
  const tree = nodes(ui.render(props)); assert.ok(tree.filter((n) => n.type === 'button').every((n) => n.props.disabled));
  assert.equal(ui.slots[1].progressPercent, 0); assert.equal(ui.slots[2], null);
  assert.ok(tree.some((n) => n.props?.children === access.TRAINER_INACTIVE_MESSAGE));
});
for (const state of ['AWAITING_ANSWER', 'REVEALED', 'CORRECT_CLEAN']) await check('Formula UI ' + state + ': inactive reply replaces controls without changing mastery', async () => {
  const ui = client('src/app/student/trainers/formula-recall/practice/formula-recall-practice.tsx', { submitFormulaRecallAnswer: async () => access.inactiveTrainerResult(), acknowledgeFormulaRecallHint: async () => access.inactiveTrainerResult(), getFormulaRecallTask: async () => access.inactiveTrainerResult() });
  const props = { initialTask: { id: task, state, condition: 'Formula', canonicalExpression: 'F=ma' }, initialSummary: { assignedCount: 1, progressPercent: 0, masteryPoints: 0 }, topicId: null };
  const tree = nodes(ui.render(props));
  tree.find((n) => n.type === 'button').props.onClick(); await settle();
  const denied = nodes(ui.render(props)); assert.ok(denied.some((n) => n.props?.role === 'alert')); assert.ok(!denied.some((n) => n.type === 'button'));
  assert.equal(ui.slots[2].masteryPoints, 0);
});
console.log(`AUDIT-02: ${passed} checks passed. SQL not applied; concurrent PostgreSQL execution requires separate runtime QA.`);
