import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
// @ts-expect-error TS5097: standalone Node TypeScript harness.
import { AnswerAutosave, interpretAnswerSaveResult } from "../src/lib/tests/answer-autosave.ts";
import type { StudentAnswer } from "../src/lib/tests/student-test-types";

// No database/network access. Exercise the actual client state machine against a
// deterministic CAS oracle; separately assert the SQL contract and unchanged grading.
const numeric = (value: number): StudentAnswer => ({ type: "NUMERIC", value });
const rows = new Map<string, { answer: StudentAnswer; revision: number }>();
let calls = 0;
let closed = false;
let expired = false;
let finalizations = 0;
async function save(key: string, answer: StudentAnswer, expected: number) {
  calls++;
  if (closed) return interpretAnswerSaveResult({ status: "closed" });
  if (expired) { finalizations++; closed = true; return interpretAnswerSaveResult({ status: "closed" }); }
  const row = rows.get(key);
  if (row && isDeepStrictEqual(row.answer, answer)) return interpretAnswerSaveResult({ status: "already_current", current_revision: row.revision });
  if ((row?.revision ?? 0) !== expected) return interpretAnswerSaveResult({ status: "conflict", current_revision: row?.revision ?? 0 });
  rows.set(key, { answer, revision: expected + 1 });
  return interpretAnswerSaveResult({ status: "saved", current_revision: expected + 1 });
}
let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) { await fn(); passed++; console.log(`PASS ${name}`); }
const a = new AnswerAutosave({}, save);
const b = new AnswerAutosave({}, save);

await check("first save expects revision 0 and confirms revision 1", async () => {
  a.edit("q", numeric(1)); assert.equal(a.revisions.get("q"), undefined);
  assert.equal(await a.persist("q"), true); assert.equal(a.revisions.get("q"), 1);
});
await check("next same-tab save confirms revision 2", async () => {
  a.edit("q", numeric(2)); assert.equal(await a.persist("q"), true); assert.equal(a.revisions.get("q"), 2);
});
await check("stale different answer conflicts without advancing revision", async () => {
  b.edit("q", numeric(3)); assert.equal(await b.persist("q"), false); assert.equal(b.revisions.get("q"), undefined);
});
await check("conflict preserves DB answer", () => { assert.deepEqual(rows.get("q"), { answer: numeric(2), revision: 2 }); });
await check("conflict preserves local dirty answer and is never Saved", () => {
  assert.deepEqual(b.dirty.get("q"), numeric(3)); assert.equal(b.state, "conflict");
});
await check("conflict blocks flush/submit and cannot retry with a new revision", async () => {
  const before = calls; let submitted = false;
  if (await b.flush({ q: numeric(3) })) submitted = true;
  assert.equal(submitted, false); assert.equal(await b.persist("q"), false); assert.equal(calls, before);
});
await check("stale same answer is already_current and hydrates DB revision", async () => {
  const response = await save("q", numeric(2), 0);
  assert.equal(response.ok, true); assert.equal(response.status, "already_current");
  const same = new AnswerAutosave({}, save); same.edit("q", numeric(2));
  assert.equal(await same.persist("q"), true); assert.equal(same.revisions.get("q"), 2); assert.equal(same.state, "saved");
});
await check("reload hydrates current revision and can save normally", async () => {
  const reload = new AnswerAutosave({ q: rows.get("q")!.revision }, save);
  reload.edit("q", numeric(4)); assert.equal(await reload.persist("q"), true); assert.equal(reload.revisions.get("q"), 3);
});
await check("equal/ahead stale counters cannot overwrite a different answer", async () => {
  assert.equal((await save("q", numeric(99), 2)).status, "conflict");
  assert.equal((await save("q", numeric(99), 99)).status, "conflict");
  assert.deepEqual(rows.get("q"), { answer: numeric(4), revision: 3 });
});
await check("same JSON object with reordered keys is idempotent", async () => {
  assert.equal((await save("q", { value: 4, type: "NUMERIC" }, 0)).status, "already_current");
});
await check("lost response followed by duplicate replay is safe", async () => {
  let lose = true;
  const network = new AnswerAutosave({}, async (...args) => {
    const result = await save(...args); if (lose) { lose = false; throw new Error("response lost"); } return result;
  });
  network.edit("replay", numeric(5)); assert.equal(await network.persist("replay"), false);
  assert.equal(network.state, "error"); assert.equal(network.dirty.size, 1);
  assert.equal(await network.persist("replay"), true); assert.equal(rows.get("replay")!.revision, 1);
  assert.equal(network.revisions.get("replay"), 1); assert.equal(network.state, "saved");
});
await check("rapid edits serialize per question and retain latest input", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const revisions: number[] = [];
  const rapid = new AnswerAutosave({}, async (key, answer, revision) => {
    revisions.push(revision); if (revisions.length === 1) await gate; return save(key, answer, revision);
  });
  rapid.edit("rapid", numeric(1)); const pending = rapid.persist("rapid");
  rapid.edit("rapid", numeric(2)); const joined = rapid.persist("rapid");
  assert.equal(revisions.length, 1); release(); await Promise.all([pending, joined]);
  assert.deepEqual(revisions, [0, 1]); assert.deepEqual(rows.get("rapid")!.answer, numeric(2)); assert.equal(rapid.state, "saved");
});
await check("in-flight conflict preserves a newer unsent local edit", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const client = new AnswerAutosave({}, async (...args) => { await gate; return save(...args); });
  client.edit("q", numeric(88)); const pending = client.persist("q");
  client.edit("q", numeric(99)); release(); assert.equal(await pending, false);
  assert.deepEqual(client.dirty.get("q"), numeric(99)); assert.equal(client.state, "conflict");
});
await check("different questions autosave independently", async () => {
  const client = new AnswerAutosave({}, save); client.edit("x", numeric(1)); client.edit("y", numeric(2));
  await Promise.all([client.persist("x"), client.persist("y")]);
  assert.equal(client.revisions.get("x"), 1); assert.equal(client.revisions.get("y"), 1);
});
await check("success on another question cannot hide an existing conflict", async () => {
  const client = new AnswerAutosave({}, save); client.edit("q", numeric(99)); client.edit("other", numeric(1));
  await Promise.all([client.persist("q"), client.persist("other")]); assert.equal(client.state, "conflict");
});
await check("normal explicit flush confirms every visible answer", async () => {
  const client = new AnswerAutosave({}, save);
  assert.equal(await client.flush({ normal: numeric(8) }), true); assert.equal(client.dirty.size, 0);
});
await check("closed attempts are errors, never concurrency conflicts", async () => {
  closed = true; const client = new AnswerAutosave({}, save); client.edit("closed", numeric(1));
  assert.equal(await client.persist("closed"), false); assert.equal(client.state, "error");
  assert.equal(rows.has("closed"), false); closed = false;
});
await check("deadline finalizes persisted data before any save/conflict handling", async () => {
  expired = true; const client = new AnswerAutosave({}, save); client.edit("q", numeric(99));
  assert.equal(await client.persist("q"), false); assert.equal(finalizations, 1);
  assert.deepEqual(rows.get("q")!.answer, numeric(4)); assert.equal(client.state, "error");
  expired = false; closed = false;
});
await check("unexpected/old boolean responses fail closed", () => {
  for (const value of [true, false, null, {}, { status: "saved" }, { status: "saved", current_revision: Infinity }]) assert.equal(interpretAnswerSaveResult(value).ok, false);
});

const sql = readFileSync("supabase/20260906-test-answer-autosave-conflict.sql", "utf8");
const runner = readFileSync("src/components/student/tests/test-runner.tsx", "utf8");
const actions = readFileSync("src/app/student/tests/actions.ts", "utf8");
await check("SQL compares JSONB equality before exact expected revision CAS", () => {
  assert.match(sql, /v_answer.answer=p_answer/); assert.match(sql, /v_revision<>p_expected_revision/);
  assert.ok(sql.indexOf("v_answer.answer=p_answer") < sql.indexOf("v_revision<>p_expected_revision"));
  assert.match(sql, /'current_revision',v_revision\+1/);
});
await check("SQL preserves lock order and deadline branch before CAS", () => {
  assert.ok(sql.indexOf("where id=p_attempt_id for update") < sql.indexOf("for share"));
  assert.ok(sql.indexOf("deadline_at<=clock_timestamp()") < sql.indexOf("v_answer.answer=p_answer"));
  assert.doesNotMatch(sql, /lock table/i);
});
await check("submit rechecks all persisted answers under attempt lock before grading", () => {
  const submit = sql.slice(sql.indexOf("create function public.submit_student_test_attempt_checked"));
  assert.ok(submit.indexOf("for update") < submit.indexOf("jsonb_object_agg"));
  assert.ok(submit.indexOf("v_answers is distinct from p_answers") < submit.indexOf("v_result:=public.submit_student_test_attempt_atomic"));
  assert.match(submit, /return jsonb_build_object\('status','conflict'\)/);
});
await check("client flush conflict returns before checked submit; controlled conflict UI", () => {
  assert.match(runner, /if \(!flushed\) \{[\s\S]*?return;/);
  assert.ok(runner.indexOf("if (!flushed)") < runner.indexOf("await submitTestAttempt"));
  assert.match(runner, /role="alert">\{answerConflictMessage\}/);
  assert.match(actions, /if \(status === "conflict"\) return \{ ok: false/);
  assert.doesNotMatch(actions, /rpc\("save_student_test_answer_if_in_progress"/);
});
await check("new RPCs are service_role only; new actions reject old argument format", () => {
  assert.match(sql, /set search_path=pg_catalog,public,pg_temp/);
  assert.match(sql, /public.submit_student_test_attempt_checked\(uuid,jsonb\) from public,anon,authenticated/);
  assert.match(actions, /if \(!version \|\| typeof version !== "object"\)/);
});
await check("OLD baseline contract remains callable after Phase migration (static)", () => {
  const baseline = "b156078167653ad747a8ee022579543fb53e66a0";
  const oldActions = execFileSync("git", ["show", `${baseline}:src/app/student/tests/actions.ts`], { encoding: "utf8" });
  const oldRpcs = [...oldActions.matchAll(/\.rpc\("([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(oldRpcs, ["save_student_test_answer_if_in_progress", "finalize_student_test_attempt_if_expired", "submit_student_test_attempt_atomic"]);
  assert.match(oldActions, /p_revision: revision/);
  assert.match(oldActions, /if \(!saved.data\)/);
  // Ignore function bodies: only new function creation/ACL changes are allowed
  // at migration scope, so existing RPCs, grants and resume tables are untouched.
  const outerSql = sql.replace(/\$\$[\s\S]*?\$\$/g, "FUNCTION_BODY").replace(/--[^\r\n]*/g, "");
  const newNames = "(?:save_student_test_answer_checked|submit_student_test_attempt_checked)";
  for (const statement of outerSql.split(";").map((part) => part.trim()).filter(Boolean)) {
    if (/^(begin|commit)$/i.test(statement)) continue;
    assert.match(statement, new RegExp(`^(?:create function|revoke all on function|grant execute on function) public\\.${newNames}\\(`, "i"));
    for (const name of oldRpcs) assert.ok(!statement.includes(name));
    const referencedFunctions = [...statement.matchAll(/public\.([a-z_]+)\(/g)].map((match) => match[1]);
    assert.ok(referencedFunctions.every((name) => /^(save_student_test_answer_checked|submit_student_test_attempt_checked)$/.test(name)));
  }
  assert.match(sql, /to service_role/);
});
await check("grading, deadline finalization and applied migrations are unchanged from baseline", () => {
  const baseline = "b156078167653ad747a8ee022579543fb53e66a0";
  const paths = execFileSync("git", ["ls-tree", "-r", "--name-only", baseline, "supabase"], { encoding: "utf8" }).trim().split(/\r?\n/);
  paths.push("src/lib/tests/grade-student-attempt.ts");
  for (const path of paths) assert.deepEqual(readFileSync(path), execFileSync("git", ["show", `${baseline}:${path}`]));
  const oldActions = execFileSync("git", ["show", `${baseline}:src/app/student/tests/actions.ts`], { encoding: "utf8" });
  const finalizer = (text: string) => text.slice(text.indexOf("export async function finalizeExpiredTestAttempt"), text.indexOf("export async function submitTestAttempt"));
  assert.equal(finalizer(actions).replaceAll("\r\n", "\n"), finalizer(oldActions).replaceAll("\r\n", "\n"));
});
console.log(`AUDIT-01: ${passed} checks passed (client runtime + DB contract assertions; no SQL applied).`);
