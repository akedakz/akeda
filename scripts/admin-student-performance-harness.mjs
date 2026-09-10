import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const baseline = "7425c7b47ddfe77014d1656f85c98c3a455b0ed6";
const read = (file) => fs.readFileSync(file, "utf8");
const loader = read("src/lib/trainers/admin-student-read-model.ts");
const core = read("src/lib/trainers/admin-student-read-model-core.ts");
const route = read("src/app/admin/students/[id]/student-tab-content.tsx");
const page = read("src/app/admin/students/[id]/page.tsx");
const progress = read("src/lib/progress/student-progress.ts");
const avatar = read("src/lib/avatars/student-avatar.ts");
let passed = 0;

function check(name, assertion) {
  assertion();
  passed += 1;
  console.log(`PASS ${name}`);
}

check("Trainers uses one request-scoped shared read model", () => {
  assert.match(loader, /cache\(async function loadAdminStudentTrainerReadModel/);
  assert.match(route, /await loadAdminStudentTrainerReadModel\(studentId, adminId\)/);
  assert.doesNotMatch(route, /loadAdminFormulaRecallAssignments|loadAdminMistakeStats|loadAdminStudentTrainerData/);
});

check("Formula assignments are fetched once", () => {
  assert.equal((loader.match(/from\("formula_recall_student_formulas"\)/g) ?? []).length, 1);
  assert.match(loader, /\.eq\("owner_admin_id", ownerAdminId\)\.eq\("student_id", studentId\)/);
});

check("Formula topics are fetched once", () => {
  assert.equal((loader.match(/from\("formula_recall_topics"\)/g) ?? []).length, 1);
});

check("Formula definitions are fetched once", () => {
  assert.equal((loader.match(/from\("formula_recall_formulas"\)/g) ?? []).length, 1);
  assert.match(loader, /select\("id,topic_id,canonical_expression,sort_order"\)/);
});

check("Quick and Theory libraries avoid full definitions", () => {
  assert.match(loader, /from\("trainers"\)\.select\("id,owner_admin_id,type,title,group_id,status"\)/);
  assert.doesNotMatch(loader, /select\([^\n]*definition[^-]/);
  assert.doesNotMatch(core, /trainer\.definition|questions\?\: unknown/);
});

check("Independent trainer queries stay in one parallel wave", () => {
  assert.match(loader, /ADMIN_STUDENT_TRAINER_QUERY_WAVES = 1/);
  assert.equal((loader.match(/await Promise\.all/g) ?? []).length, 1);
  assert.ok((loader.match(/db\.from\(|db\.rpc\(/g) ?? []).length >= 10);
});

check("Student ownership filters are preserved", () => {
  assert.ok((loader.match(/\.eq\("student_id", studentId\)/g) ?? []).length >= 4);
  assert.match(loader, /p_student_id: studentId/);
  assert.match(loader, /mistake\.student_id", studentId/);
});

check("Admin ownership filters are preserved", () => {
  assert.ok((loader.match(/\.eq\("owner_admin_id", ownerAdminId\)/g) ?? []).length >= 7);
  assert.match(loader, /p_owner_admin_id: ownerAdminId/);
  assert.match(core, /trainer\.owner_admin_id !== rows\.ownerAdminId/);
});

check("Mistake counts keep canonical scoped queries", () => {
  assert.match(loader, /student_mistakes[\s\S]*count: "exact", head: true[\s\S]*status", "ACTIVE"/);
  assert.match(loader, /student_mistake_correction_attempts[\s\S]*mistake\.owner_admin_id[\s\S]*is_correct", true/);
  assert.match(core, /active: rows\.activeMistakes, corrected: rows\.correctedMistakes/);
});

check("Quick progress keeps fingerprint and credit semantics", () => {
  assert.match(core, /fingerprintTrainerSkill\(skill\)/);
  assert.match(core, /accepted\.get\(progress\.skill_key\) === progress\.skill_fingerprint/);
  assert.match(core, /Math\.min\(5, Math\.max\(0, progress\.credited_correct\)\)/);
});

check("Theory progress keeps required and earned semantics", () => {
  assert.match(core, /row\.question_count \* 3/);
  assert.match(core, /row\.kind === "COMPLETED" \? required : Math\.min\(required, Math\.max\(0, row\.earned\)\)/);
});

check("Formula mastery summary keeps canonical semantics", () => {
  assert.match(core, /FORMULA_RECALL_MASTERY_TARGET/);
  assert.match(core, /Math\.min\(FORMULA_RECALL_MASTERY_TARGET, Math\.max\(0, assignment\.clean_recall_count\)\)/);
  assert.match(core, /assignment\.clean_recall_count === FORMULA_RECALL_MASTERY_TARGET/);
});

check("Existing sorting contracts are retained", () => {
  assert.match(loader, /formula_recall_topics[\s\S]*\.order\("sort_order"\)/);
  assert.match(loader, /formula_recall_formulas[\s\S]*\.order\("sort_order"\)/);
  assert.match(loader, /trainer_groups[\s\S]*\.order\("sort_order"\)/);
  assert.match(core, /rows\.formulaTopics\.map/);
});

check("Materials, Tests and Results remove avoidable serialized reads", () => {
  assert.match(route, /viewedOnlyMaterialIds = \[\.\.\.new Set/);
  assert.match(route, /filter\(\(id\) => !accessMaterialIdSet\.has\(id\)\)/);
  assert.match(route, /select\("id, title"\)\.in\("id", viewedOnlyMaterialIds\)/);
  assert.match(route, /\[assignmentResult, attemptsResult\] = await Promise\.all/);
  assert.match(progress, /const attemptsPromise = Promise\.resolve/);
  assert.match(progress, /legacyAnswersPromise/);
});

check("Profile remains fresh while avatar signing is safely reused", () => {
  assert.match(page, /from\("profiles"\)/);
  assert.match(page, /preloadAdminStudentTrainerReadModel/);
  assert.match(avatar, /unstable_cache\(signStudentAvatar/);
  assert.match(avatar, /revalidate:300/);
  assert.match(page, /createAdminStudentAvatarUrl/);
});

check("No student runtime, grading, Formula runtime or applied migration changed", () => {
  execFileSync("git", ["diff", "--quiet", baseline, "--", "src/app/student", "src/lib/formula-recall/runtime-data.ts", "src/lib/formula-recall/formula-checker.ts", "src/lib/mistakes", "src/lib/tests", "supabase", ":(exclude)supabase/20260909-formula-recall-batch-create.sql"]);
});

console.log(`Admin student performance: ${passed} checks passed; no browser, production DB or migration used.`);
