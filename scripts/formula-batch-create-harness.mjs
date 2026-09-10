import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const baseline = "700cf63f0a4f96479cb51422bc42d18d9317a02e";
const read = (file) => fs.readFileSync(file, "utf8");
const migrationPath = "supabase/20260909-formula-recall-batch-create.sql";
const sql = read(migrationPath);
const batch = read("src/app/admin/trainers/formula-recall/formula-batch-create-form.tsx");
const fields = read("src/app/admin/trainers/formula-recall/formula-draft-fields.tsx");
const actions = read("src/app/admin/trainers/formula-recall/actions.ts");
const createPage = read("src/app/admin/trainers/formula-recall/new/page.tsx");
const editPage = read("src/app/admin/trainers/formula-recall/[formulaId]/edit/page.tsx");
const data = read("src/lib/formula-recall/data.ts");
let passed = 0;

function check(name, assertion) {
  assertion();
  passed += 1;
  console.log(`PASS ${name}`);
}

check("create route starts with one stable draft and three conditions", () => {
  assert.match(createPage, /initialDraftId=\{randomUUID\(\)\}/);
  assert.match(createPage, /initialConditionIds=\{\[randomUUID\(\), randomUUID\(\), randomUUID\(\)\]\}/);
  assert.match(batch, /\[createEditableFormulaDraft\(initialDraftId, initialConditionIds\)\]/);
});

check("adding multiple formulas is client-only and capped", () => {
  assert.match(batch, /const addDraft = \(\) =>/);
  assert.match(batch, /createEditableFormulaDraft\(id, \[crypto\.randomUUID\(\), crypto\.randomUUID\(\), crypto\.randomUUID\(\)\]\)/);
  assert.match(batch, /drafts\.length >= 50/);
  assert.doesNotMatch(fields, /from "\.\/actions"/);
});

check("one shared topic applies to every submitted formula", () => {
  assert.equal((batch.match(/<select value=\{topicId\}/g) ?? []).length, 1);
  assert.match(batch, /saveFormulaRecallFormulasBatch\(\{ requestId, topicId, formulas \}\)/);
  assert.match(actions, /topicId: input\.topicId/);
});

check("formula cards use stable UUID keys", () => {
  assert.match(batch, /key=\{draft\.id\}/);
  assert.doesNotMatch(batch, /key=\{index\}/);
});

check("removing a middle draft is identity-based", () => {
  assert.match(batch, /items\.filter\(\(item\) => item\.id !== draftId\)/);
  assert.match(batch, /drafts\.length === 1/);
});

check("conditions remain independent per formula", () => {
  assert.match(fields, /draft\.conditions\.map/);
  assert.match(fields, /item\.id === condition\.id/);
  assert.match(fields, /conditions: \[\.\.\.draft\.conditions/);
});

check("alternatives remain independent per formula", () => {
  assert.match(fields, /draft\.alternatives\.map/);
  assert.match(fields, /item\.id === alternative\.id/);
  assert.match(fields, /alternatives: \[\.\.\.draft\.alternatives/);
});

check("untouched blank extra cards are ignored", () => {
  assert.match(fields, /hasMeaningfulFormulaInput/);
  assert.match(batch, /hasMeaningfulFormulaInput\(draft\) \? \[\{ draft, draftIndex \}\] : \[\]/);
});

check("partial card without canonical formula is rejected locally", () => {
  assert.match(batch, /validateFormulaRecallDraft/);
  assert.match(batch, /setErrors\(\{ \[candidate\.draft\.id\]: validation\.message \}\)/);
});

check("SQL validation index maps back to the original card", () => {
  assert.match(sql, /'formula_index',formula_number-1/);
  assert.match(batch, /candidates\[result\.formulaIndex\]/);
  assert.match(batch, /invalid\.draftIndex \+ 1/);
});

check("the batch is one RPC and one PostgreSQL subtransaction", () => {
  assert.equal((actions.match(/save_formula_recall_formulas_batch_atomic/g) ?? []).length, 1);
  assert.match(sql, /begin[\s\S]*for formula_item, formula_number[\s\S]*raise exception using errcode='FRB01'[\s\S]*exception[\s\S]*when sqlstate 'FRB01'/);
  assert.doesNotMatch(sql, /P0001/);
  assert.doesNotMatch(batch, /Promise\.all|saveFormulaRecallFormula\(/);
});

check("failure of formula N rolls back preceding formula and child writes", () => {
  assert.match(sql, /save_result := public\.save_formula_recall_formula_atomic/);
  assert.match(sql, /save_result->>'status' is distinct from 'saved'/);
  assert.match(sql, /raise exception using errcode='FRB01'[\s\S]*insert into public\.formula_recall_batch_requests[\s\S]*exception[\s\S]*when sqlstate 'FRB01'/);
  assert.match(sql, /when others then\s+return jsonb_build_object\('status','save_failed'\)/);
  assert.match(sql, /return jsonb_build_object\('status','invalid_formula','formula_index',failure_index/);
});

check("same request replay is persisted and serialized", () => {
  assert.match(sql, /primary key \(owner_admin_id, request_id\)/);
  assert.match(sql, /p_request_id::text\|\|':formula-recall-batch'/);
  assert.ok(sql.indexOf("pg_advisory_xact_lock(hashtextextended(p_owner_admin_id::text||':'||p_request_id::text||':formula-recall-batch',8202))")
    < sql.indexOf("select * into stored_request from public.formula_recall_batch_requests"));
  assert.match(sql, /'\"already_saved\"'::jsonb/);
});

check("same request with a different canonical payload conflicts", () => {
  assert.match(sql, /stored_request\.payload_hash <> normalized_hash/);
  assert.match(sql, /jsonb_build_object\('status','request_conflict'\)/);
  assert.match(actions, /data\?\.status === "request_conflict"/);
});

check("payload hash is canonical JSONB SHA-256, not a raw JSON string", () => {
  assert.match(sql, /normalized_payload := jsonb_build_object/);
  assert.match(sql, /btrim\(formula_item->>'canonical_expression'\)/);
  assert.match(sql, /pg_catalog\.encode\(pg_catalog\.sha256\(pg_catalog\.convert_to\(normalized_payload::text,'UTF8'\)\),'hex'\)/);
});

check("duplicate submit is synchronously blocked and retry reuses request ID", () => {
  assert.match(batch, /if \(submitGuard\.current\) return/);
  assert.match(batch, /submitGuard\.current = true/);
  assert.match(batch, /requestAttempt\.current\.payload !== payload/);
  assert.match(batch, /requestAttempt\.current\.requestId/);
});

check("batch and child payload limits are enforced", () => {
  assert.match(sql, /jsonb_array_length\(p_formulas\) not between 1 and 50/);
  assert.match(sql, /char_length\(p_formulas::text\) > 250000/);
  assert.match(actions, /input\.formulas\.length < 1 \|\| input\.formulas\.length > 50/);
  assert.match(actions, /JSON\.stringify\(input\.formulas\)\.length > 250000/);
  assert.match(actions, /validateFormulaRecallDraft/);
  assert.match(sql, /jsonb_typeof\(formula_item->'canonical_expression'\).*<> 'string'/s);
  assert.match(sql, /jsonb_typeof\(condition_item->'text'\).*<> 'string'/s);
  assert.match(sql, /jsonb_typeof\(alternative_item->'expression'\).*<> 'string'/s);
});

check("topic and admin ownership are enforced", () => {
  assert.match(sql, /profiles where id=p_owner_admin_id and role='ADMIN'/);
  assert.match(sql, /formula_recall_topics where id=p_topic_id and owner_admin_id=p_owner_admin_id for update/);
  assert.match(actions, /const ctx = await context\(\)/);
  assert.doesNotMatch(batch, /ownerAdminId|owner_id|owner_admin_id/);
});

check("canonical topic lock preserves consecutive sort order", () => {
  assert.match(sql, /p_owner_admin_id::text\|\|':'\|\|p_topic_id::text\|\|':formula-recall-formulas'/);
  assert.ok(sql.indexOf("formula_recall_topics where id=p_topic_id and owner_admin_id=p_owner_admin_id for update")
    < sql.indexOf("p_owner_admin_id::text||':'||p_topic_id::text||':formula-recall-formulas'"));
  assert.match(sql, /save_formula_recall_formula_atomic/);
});

check("composite topic foreign key has an existing unique target", () => {
  const librarySql = read("supabase/20260903-formula-recall-library.sql");
  assert.match(librarySql, /create table public\.formula_recall_topics \([\s\S]*unique \(id, owner_admin_id\)[\s\S]*\);/);
  assert.match(sql, /foreign key \(topic_id, owner_admin_id\) references public\.formula_recall_topics\(id, owner_admin_id\)/);
});

check("edit route remains the single-formula editor", () => {
  assert.match(editPage, /FormulaRecallEditorForm/);
  assert.doesNotMatch(editPage, /FormulaRecallBatchCreateForm|saveFormulaRecallFormulasBatch/);
  assert.match(createPage, /FormulaRecallBatchCreateForm/);
});

check("single save still uses the canonical RPC", () => {
  assert.match(actions, /export async function saveFormulaRecallFormula[\s\S]*save_formula_recall_formula_atomic/);
  assert.match(actions, /validateFormulaRecallDraft\(draft\)/);
});

check("new route loads topics once without the Formula library", () => {
  assert.match(createPage, /loadFormulaRecallTopics/);
  assert.doesNotMatch(createPage, /loadFormulaRecallLibrary/);
  assert.match(data, /export async function loadFormulaRecallTopics/);
});

check("idempotency table and RPC are service-role only", () => {
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.formula_recall_batch_requests from public, anon, authenticated, service_role/);
  assert.match(sql, /security definer[\s\S]*set search_path=pg_catalog,public,pg_temp/);
  assert.match(sql, /grant execute on function public\.save_formula_recall_formulas_batch_atomic\(uuid,uuid,uuid,jsonb\) to service_role/);
});

check("applied migrations and student runtime/mastery remain unchanged", () => {
  const files = execFileSync("git", ["ls-tree", "-r", "--name-only", baseline, "supabase"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  for (const file of files) assert.deepEqual(fs.readFileSync(file), execFileSync("git", ["show", `${baseline}:${file}`]), file);
  execFileSync("git", ["diff", "--quiet", baseline, "--", "src/app/student", "src/lib/formula-recall/formula-checker.ts", "src/lib/formula-recall/runtime-data.ts", "src/lib/formula-recall/runtime-types.ts"]);
});

console.log(`Formula Recall batch create: ${passed} checks passed. Migration was inspected statically and was not applied.`);
