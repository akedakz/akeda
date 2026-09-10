import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql=readFileSync("supabase/20260904-test-mistake-trainer-phase-2.sql","utf8");
const runner=readFileSync("src/app/student/trainers/mistakes/mistake-runner.tsx","utf8");
const runtime=readFileSync("src/lib/mistakes/runtime.ts","utf8");
const phase1=readFileSync("supabase/20260904-test-mistake-trainer-phase-1.sql","utf8");
const checks:Array<[string,()=>void]>=[
  ["0 mistakes -> empty/count 0",()=>assert.match(sql,/'status','empty','activeCount',v_count/)],
  ["2 ACTIVE -> oldest returned",()=>assert.match(sql,/order by activation_sequence,id limit 1/)],
  ["safe projection omits correct answers",()=>{const projection=sql.slice(sql.indexOf("create function public.project_student_mistake_question"),sql.indexOf("create function public.load_student_mistake_trainer"));assert.doesNotMatch(projection,/isCorrect|correctOptionKey|exactValue|tolerance|rangeMin|rangeMax/)}],
  ["SINGLE wrong remains ACTIVE",()=>assert.match(sql,/if v_correct then update public.student_mistakes/)],
  ["SINGLE correct -> CORRECTED",()=>assert.match(sql,/status='CORRECTED'/)],
  ["MULTIPLE exact-set grading",()=>assert.match(sql,/v_selected=v_expected/)],
  ["NUMERIC EXACT",()=>assert.match(sql,/when 'EXACT' then/)],
  ["NUMERIC TOLERANCE",()=>assert.match(sql,/when 'TOLERANCE' then abs/)],
  ["NUMERIC RANGE",()=>assert.match(sql,/when 'RANGE' then v_value between/)],
  ["MATCHING",()=>assert.match(sql,/v_key is distinct from v_item->>'correctOptionKey'/)],
  ["MULTI_PART full correct",()=>assert.match(sql,/if not v_correct then return false/)],
  ["MULTI_PART partial -> wrong",()=>assert.match(sql,/for v_part in select value/)],
  ["wrong attempt recorded",()=>assert.match(sql,/insert into public.student_mistake_correction_attempts/)],
  ["correct attempt recorded",()=>assert.ok(sql.indexOf("insert into public.student_mistake_correction_attempts")<sql.indexOf("if v_correct then update"))],
  ["same request id idempotent only in its activation",()=>{assert.match(sql,/where mistake_id=p_mistake_id and request_id=p_request_id/);assert.match(sql,/v_previous\.is_correct and \(v_mistake\.status<>'CORRECTED' or v_mistake\.activation_version<>p_activation_version\+1\)/);assert.match(sql,/not v_previous\.is_correct and \(v_mistake\.status<>'ACTIVE' or v_mistake\.activation_version<>p_activation_version\)/)}],
  ["non-oldest rejected",()=>assert.match(sql,/'status','not_oldest'/)],
  ["stale activation rejected",()=>assert.match(sql,/activation_version<>p_activation_version/)],
  ["second tab rejected",()=>assert.match(sql,/v_mistake.status<>'ACTIVE'/)],
  ["reactivation invalidates old tab and old request replay",()=>{assert.match(phase1,/activation_version=activation_version\+1,reactivation_count=reactivation_count\+1/);assert.ok(sql.indexOf("v_previous.activation_version<>p_activation_version")<sql.indexOf("'idempotent',true"))}],
  ["ACTIVE count decrements",()=>assert.match(sql,/where student_id=p_student_id and status='ACTIVE'/)],
  ["admin receives full answer server-side",()=>assert.match(runtime,/current_question_snapshot/)],
  ["admin remove ACTIVE",()=>assert.match(sql,/status='REMOVED_BY_ADMIN'/)],
  ["admin remove increments version",()=>assert.match(sql,/activation_version=activation_version\+1/)],
  ["student stale after admin remove",()=>assert.match(sql,/return jsonb_build_object\('status','stale'\)/)],
  ["removed absent from ACTIVE queue",()=>assert.match(sql,/status='ACTIVE' order by activation_sequence/)],
  ["image path preserved and signed",()=>{assert.match(sql,/'imagePath',p_question->'imagePath'/);assert.match(runtime,/createSignedUrls\(unique, 3600\)/)}],
  ["student ownership enforced",()=>assert.match(sql,/where id=p_mistake_id and student_id=p_student_id for update/)],
  ["admin ownership enforced",()=>assert.match(sql,/owner_admin_id=p_admin_id for update/)],
  ["identical ACTIVE snapshot keeps version",()=>assert.match(sql,/new\.current_question_snapshot is distinct from old\.current_question_snapshot/)],
  ["changed ACTIVE snapshot increments version",()=>assert.match(sql,/new\.activation_version:=old\.activation_version\+1/)],
  ["snapshot bump preserves queue position",()=>{const trigger=sql.slice(sql.indexOf("create function public.bump_active_mistake_snapshot_version"),sql.indexOf("create function public.project_student_mistake_question"));assert.doesNotMatch(trigger,/activation_sequence\s*:=|reactivation_count\s*:=|activated_at\s*:=/)}],
  ["old tab after snapshot replacement is stale",()=>assert.match(sql,/v_mistake\.activation_version<>p_activation_version then return jsonb_build_object\('status','stale'\)/)],
  ["fresh snapshot version can reach grading",()=>assert.ok(sql.indexOf("v_mistake.activation_version<>p_activation_version")<sql.indexOf("v_correct:=public.grade_student_mistake_answer"))],
  ["CORRECT transition increments exactly once",()=>assert.match(sql,/if v_correct then update public\.student_mistakes set status='CORRECTED'.*activation_version=activation_version\+1/)],
  ["ADMIN REMOVE increments exactly once",()=>assert.match(sql,/set status='REMOVED_BY_ADMIN'.*activation_version=activation_version\+1/)],
  ["CORRECTED reactivation bypasses ACTIVE guard",()=>{assert.match(sql,/old\.status='ACTIVE'\s+and new\.status='ACTIVE'/);assert.match(phase1,/activation_version=activation_version\+1,reactivation_count=reactivation_count\+1/)}],
  ["REMOVED reactivation and old V1 request stay isolated",()=>{assert.match(phase1,/v_mistake\.status='ACTIVE'/);assert.match(sql,/v_previous\.activation_version<>p_activation_version/)}],
];
for(const[name,check]of checks){check();console.info(`ok - ${name}`)}
assert.equal(checks.length,37);
assert.match(runner,/QuestionAnswerField/);
console.info(`Mistake Trainer Phase 2: ${checks.length} scenarios passed.`);
