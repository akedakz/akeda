import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { releasePending, tryAcquirePending } from "../src/lib/ui/pending-guard.ts";

const root = process.cwd();
const read = (file) => fs.readFileSync(`${root}/${file}`, "utf8");
let passed = 0;

function check(name, assertion) {
  assertion();
  passed += 1;
  console.log(`PASS ${name}`);
}

check("shared pending guard rejects overlap and recovers", () => {
  const guard = { current: false };
  assert.equal(tryAcquirePending(guard), true);
  assert.equal(tryAcquirePending(guard), false);
  releasePending(guard);
  assert.equal(tryAcquirePending(guard), true);
});

const payments = read("src/app/admin/payments/payments-tracker.tsx");
check("paid toggle has a synchronous per-row guard", () => {
  assert.match(payments, /tryAcquirePending\(paidGuard\)/);
  assert.match(payments, /paidRevision/);
});
check("paid toggle rollback only restores paid fields", () => {
  assert.match(payments, /setPaid\(id, previous\.paid, previous\.paidAt\)/);
  assert.doesNotMatch(payments, /\? row : item/);
});
check("paid stale response is ignored", () => {
  assert.match(payments, /operation !== paidRevision\.current/);
  assert.match(payments, /operation === paidRevision\.current/);
});
check("delete exposes pending UI and blocks a second delete", () => {
  assert.match(payments, /tryAcquirePending\(deleteGuard\)/);
  assert.match(payments, /setDeleting\(true\)/);
  assert.match(payments, /deleting \? "Удаляем…"/);
  assert.match(payments, /disabled=\{deleting \|\| paidPending/);
});
check("autosave does not overlap paid or delete mutations", () => {
  assert.match(payments, /running\.current \|\| paidGuard\.current \|\| deleteGuard\.current/);
  assert.match(payments, /revision\.current > savedRevision\.current\) schedule\(0\)/);
});

for (const [name, file] of [
  ["test folders", "src/app/admin/tests/test-library-explorer.tsx"],
  ["material folders", "src/app/admin/materials/material-library-explorer.tsx"],
]) check(`${name}: pending dialog cannot close or submit twice`, () => {
  const source = read(file);
  assert.match(source, /tryAcquirePending\(pendingGuard\)/);
  assert.match(source, /aria-busy=\{pending\}/);
  assert.match(source, /disabled=\{pending\}[^>]*onClick=\{closeModal\}/);
  assert.match(source, /event\.key\s*!==\s*"Escape"/);
});

check("Formula Recall destructive dialogs use the pending contract", () => {
  const source = read("src/app/admin/trainers/formula-recall/formula-recall-library.tsx");
  assert.match(source, /function Dialog\(\{ title, close, pending/);
  assert.equal((source.match(/tryAcquirePending\(pendingGuard\)/g) ?? []).length, 2);
  assert.match(source, /disabled=\{pending\} onClick=\{safeClose\}/);
});

check("Theory dialogs block every close path while pending", () => {
  const source = read("src/app/admin/trainers/theory/theory-library.tsx");
  assert.match(source, /aria-busy=\{pending\}/);
  assert.match(source, /event\.key\s*!==\s*"Escape"/);
  assert.ok((source.match(/tryAcquirePending\(pendingGuard\)/g) ?? []).length >= 4);
});

check("Quick Problems destructive dialog closes through its synchronous guard", () => {
  const source = read("src/app/admin/trainers/quick-problems/quick-problems-library.tsx");
  assert.match(source, /tryAcquirePending\(pendingGuard\)/);
  assert.match(source, /const safeClose = \(\) =>/);
});

check("trainer group dialogs block close and duplicate actions", () => {
  const source = read("src/components/trainers/trainer-group-ui.tsx");
  assert.ok((source.match(/tryAcquirePending\(guard\)/g) ?? []).length >= 3);
  assert.match(source, /aria-busy=\{pending\}/);
  assert.match(source, /event\.key!=="Escape"/);
});

check("dialog failures release guards and keep controlled errors", () => {
  for (const file of [
    "src/app/admin/tests/test-library-explorer.tsx",
    "src/app/admin/materials/material-library-explorer.tsx",
    "src/app/admin/trainers/formula-recall/formula-recall-library.tsx",
    "src/app/admin/trainers/theory/theory-library.tsx",
  ]) {
    const source = read(file);
    assert.match(source, /catch/);
    assert.match(source, /releasePending/);
    assert.match(source, /role="alert"/);
  }
});

check("main navigation starts pending on SPA navigation without changing prefetch", () => {
  const link = read("src/components/student/tests/intent-prefetch-link.tsx");
  const nav = read("src/components/admin/admin-nav-link.tsx");
  assert.match(link, /onNavigate=\{\(event\) =>/);
  assert.match(link, /data-navigation-pending=\{pending \|\| undefined\}/);
  assert.match(link, /tryAcquirePending\(pendingGuard\)/);
  assert.match(nav, /mode=\{intentPrefetchRoutes\.has\(href\) \? "intent" : "auto"\}/);
  assert.match(nav, /lockWhilePending/);
});

check("student tab navigation serializes transitions and resets from activeTab", () => {
  const source = read("src/components/students/student-page-tabs.tsx");
  assert.match(source, /if \(pendingGuard\.current\) \{ event\.preventDefault\(\); return; \}/);
  assert.match(source, /tryAcquirePending\(pendingGuard\)/);
  assert.match(source, /releasePending\(pendingGuard\)/);
  assert.match(source, /\}, \[activeTab\]\)/);
});

check("support message update cannot reopen a stale modal", () => {
  const source = read("src/app/admin/settings/messages/messages-settings.tsx");
  assert.match(source, /const messageId = selected\.id/);
  assert.match(source, /setSelected\(\(current\) => current\?\.id === messageId/);
  assert.match(source, /if \(!pendingGuard\.current\) setSelected\(null\)/);
  assert.match(source, /disabled=\{pending\} aria-label="Закрыть"/);
});

check("template reorder is serialized with optimistic rollback", () => {
  const source = read("src/app/admin/settings/topic-templates/[templateId]/template-editor.tsx");
  assert.match(source, /pendingGuard\.current\) return/);
  assert.match(source, /tryAcquirePending\(pendingGuard\)/);
  assert.match(source, /setItems\(previous\)/);
  assert.match(source, /useSortable\(\{ id: item\.id, disabled \}\)/);
});

check("Batch 1 leaves payment actions, runtime and SQL untouched", () => {
  execFileSync("git", ["diff", "--quiet", "9f627932873613b27dfdb292c0f20bdbc262ac75", "--", "src/app/admin/payments/actions.ts", "src/app/student", "src/lib/formula-recall/formula-checker.ts", "src/lib/tests", "src/lib/mistakes", "supabase", ":(exclude)supabase/20260909-formula-recall-batch-create.sql"]);
});

console.log(`Admin Batch 1 UX: ${passed} focused checks passed; no browser or database mutations used.`);
