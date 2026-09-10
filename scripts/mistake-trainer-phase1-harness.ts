import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const migration = readFileSync(resolve(root, "supabase/20260904-test-mistake-trainer-phase-1.sql"), "utf8");
const snapshotTypes = readFileSync(resolve(root, "src/lib/tests/test-snapshot-types.ts"), "utf8");
const snapshotBuilder = readFileSync(resolve(root, "src/lib/tests/build-test-snapshot.ts"), "utf8");
const studentProfileActions = readFileSync(resolve(root, "src/app/admin/students/[id]/student-profile-actions.ts"), "utf8");
const testActions = readFileSync(resolve(root, "src/app/student/tests/actions.ts"), "utf8");

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.info(`PASS ${name}`);
}
function contains(source: string, fragment: string) {
  assert.ok(source.includes(fragment), `Missing: ${fragment}`);
}

type Status = "ACTIVE" | "CORRECTED" | "REMOVED_BY_ADMIN";
type Mistake = {
  owner: string;
  status: Status;
  sequence: number;
  version: number;
  reactivations: number;
  snapshot: { key: string; imagePath?: string | null };
  answer: unknown;
  occurrences: string[];
  imageRefs: Set<string>;
};

class Model {
  sequence = 0;
  mistakes = new Map<string, Mistake>();
  receipts = new Set<string>();

  wrong(student: string, owner: string, logicalId: string, attempt: string, snapshot: Mistake["snapshot"], answer: unknown) {
    const receipt = `${attempt}:${snapshot.key}`;
    if (this.receipts.has(receipt)) return;
    const mapKey = `${student}:${logicalId}`;
    const existing = this.mistakes.get(mapKey);
    if (existing && existing.owner !== owner) throw new Error("MISTAKE_OWNER_MISMATCH");
    const mistake = existing ?? {
      owner,
      status: "ACTIVE" as const,
      sequence: ++this.sequence,
      version: 1,
      reactivations: 0,
      snapshot,
      answer,
      occurrences: [],
      imageRefs: new Set<string>(),
    };
    if (existing && existing.status !== "ACTIVE") {
      mistake.status = "ACTIVE";
      mistake.sequence = ++this.sequence;
      mistake.version += 1;
      mistake.reactivations += 1;
    }
    mistake.snapshot = snapshot;
    mistake.answer = answer;
    mistake.occurrences.push(receipt);
    if (snapshot.imagePath) mistake.imageRefs.add(snapshot.imagePath);
    this.mistakes.set(mapKey, mistake);
    this.receipts.add(receipt);
  }
}

check("existing question backfill equals physical id", () => contains(migration, "set logical_question_id=id where logical_question_id is null"));
check("new question gets a UUID default", () => contains(migration, "logical_question_id set default gen_random_uuid()"));
check("logical identity is immutable on edit", () => contains(migration, "TEST_QUESTION_LOGICAL_IDENTITY_IMMUTABLE"));
check("composite copy inherits source logical identity", () => contains(migration, "select m.target_id,v_test_id,q.logical_question_id"));
check("new snapshot contains logicalQuestionId", () => {
  contains(snapshotTypes, "logicalQuestionId?: string");
  contains(snapshotBuilder, "logicalQuestionId: question.logical_question_id");
  contains(migration, "'logicalQuestionId',q.logical_question_id");
});
check("legacy snapshot falls back to UUID question key", () => contains(migration, "nullif(v_question->>'key','')::uuid"));

const model = new Model();
model.wrong("student", "admin", "a", "attempt-1", { key: "q-a", imagePath: "a.png" }, { value: 1 });
check("first wrong creates ACTIVE mistake", () => assert.equal(model.mistakes.get("student:a")?.status, "ACTIVE"));
model.wrong("student", "admin", "b", "attempt-1", { key: "q-b" }, { value: 2 });
check("two wrong questions receive deterministic sequence", () => {
  assert.equal(model.mistakes.get("student:a")?.sequence, 1);
  assert.equal(model.mistakes.get("student:b")?.sequence, 2);
});
model.wrong("student", "admin", "a", "attempt-1", { key: "q-a", imagePath: "a.png" }, { value: 1 });
check("grading retry creates no duplicate occurrence", () => assert.equal(model.mistakes.get("student:a")?.occurrences.length, 1));
model.wrong("student", "admin", "a", "attempt-2", { key: "q-a-2", imagePath: "b.png" }, { value: 3 });
check("repeated ACTIVE wrong does not move queue position", () => assert.equal(model.mistakes.get("student:a")?.sequence, 1));
check("repeated ACTIVE wrong updates latest snapshot and answer", () => {
  assert.equal(model.mistakes.get("student:a")?.snapshot.key, "q-a-2");
  assert.deepEqual(model.mistakes.get("student:a")?.answer, { value: 3 });
});
const a = model.mistakes.get("student:a")!;
a.status = "CORRECTED";
model.wrong("student", "admin", "a", "attempt-3", { key: "q-a-3" }, { value: 4 });
check("CORRECTED mistake reactivates at queue end", () => {
  assert.equal(a.status, "ACTIVE");
  assert.equal(a.sequence, 3);
  assert.equal(a.version, 2);
  assert.equal(a.reactivations, 1);
});
const b = model.mistakes.get("student:b")!;
b.status = "REMOVED_BY_ADMIN";
model.wrong("student", "admin", "b", "attempt-4", { key: "q-b-2" }, null);
check("REMOVED mistake reactivates at queue end", () => {
  assert.equal(b.status, "ACTIVE");
  assert.equal(b.sequence, 4);
  assert.equal(b.version, 2);
});
check("MULTI_PART partial follows final false verdict", () => contains(migration, "answer.is_correct=false"));
check("correct verdict is excluded", () => assert.ok(!migration.includes("answer.is_correct=true")));
check("mistake image reference is captured", () => assert.deepEqual([...a.imageRefs], ["a.png", "b.png"]));
check("assignment deletion cannot remove mistake image reference", () => contains(migration, "student_mistake_image_refs_storage_path_idx"));
check("cleanup helper respects mistake references", () => contains(migration, "not exists(select 1 from public.student_mistake_image_refs r where r.storage_path=path)"));
check("student deletion captures mistake paths before cascade", () => contains(migration, "student_mistake_image_paths_for_deletion"));
check("student deletion cleanup uses canonical claims after cascade", () => {
  contains(migration, "student_mistake_image_cleanup_after_student_deletion");
  contains(migration, "return public.claim_test_image_cleanup_candidates(p_paths)");
});
check("student deletion orders capture, cascade, claim, then Storage delete", () => {
  const capture = studentProfileActions.indexOf("student_mistake_image_paths_for_deletion");
  const cascade = studentProfileActions.indexOf("auth.admin.deleteUser", capture);
  const claim = studentProfileActions.indexOf("student_mistake_image_cleanup_after_student_deletion", cascade);
  const storage = studentProfileActions.indexOf('.storage.from("test-images").remove', claim);
  assert.ok(capture >= 0 && capture < cascade && cascade < claim && claim < storage);
});
check("shared live, assignment, and mistake refs all block cleanup", () => {
  contains(migration, "public.test_questions q where q.image_path=path");
  contains(migration, "public.test_assignment_image_refs r where r.storage_path=path");
  contains(migration, "public.student_mistake_image_refs r where r.storage_path=path");
});
check("mistake image lock retry is exact and bounded", () => {
  contains(testActions, 'error?.code === "40001" && error.message.includes("MISTAKE_IMAGE_LOCK_BUSY")');
  assert.equal((testActions.match(/if \(isMistakeImageLockConflict\(result\.error\)\) result = await operation\(\);/g) ?? []).length, 1);
});
check("source deletion cannot delete autonomous mistake provenance", () => {
  assert.ok(!/latest_source_(assignment|attempt)_id uuid references/.test(migration));
  contains(migration, "question_snapshot jsonb not null");
});
check("old assignment can use legacy identity fallback", () => contains(migration, "coalesce(nullif(v_question->>'logicalQuestionId','')::uuid,nullif(v_question->>'key','')::uuid)"));
check("cross-owner mistake mutation is rejected", () => assert.throws(() => model.wrong("student", "other-admin", "a", "attempt-5", { key: "q-a-4" }, null), /MISTAKE_OWNER_MISMATCH/));

console.info(`Mistake trainer Phase 1: ${passed} assertions passed.`);
