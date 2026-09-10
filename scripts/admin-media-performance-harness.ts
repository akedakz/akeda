import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
// @ts-expect-error TS5097: standalone Node TypeScript harness.
import { runBoundedImportUploads, TEST_IMPORT_UPLOAD_CONCURRENCY } from "../src/lib/tests/bounded-import-uploads.ts";
// @ts-expect-error TS5097: standalone Node TypeScript harness.
import { signStoragePathsBatch } from "../src/lib/storage/sign-storage-paths-batch.ts";

const baseline = "597d70baeceb777c34775c0f3aa6006671e5795e";
const read = (path: string) => readFileSync(path, "utf8");
const editor = read("src/app/admin/tests/[id]/page.tsx");
const preview = read("src/app/admin/tests/[id]/preview/page.tsx");
const assignment = read("src/app/admin/students/[id]/tests/[assignmentId]/page.tsx");
const attempt = read("src/app/admin/students/[id]/tests/[assignmentId]/attempts/[attemptId]/page.tsx");
const materialApi = read("src/app/api/admin/material-library/route.ts");
const materialDetail = read("src/app/admin/materials/[id]/page.tsx");
const materialActions = read("src/app/admin/materials/actions.ts");
const materialLoader = read("src/lib/materials/load-material-library.ts");
const modal = read("src/app/admin/tests/test-import-modal.tsx");
const importActions = read("src/app/admin/tests/import-actions.ts");
const importSession = read("src/lib/tests/test-import-session.ts");
const uploadRoute = read("src/app/api/admin/test-import-image/route.ts");
let passed = 0;

async function check(name: string, assertion: () => void | Promise<void>) {
  await assertion();
  passed += 1;
  console.log(`PASS ${name}`);
}

await check("duplicate storage paths are deduplicated before one batch request", async () => {
  let requested: string[] = [];
  const admin = { storage: { from: () => ({ createSignedUrls: async (paths: string[]) => {
    requested = paths;
    return { data: paths.map((path) => ({ path, signedUrl: `signed:${path}`, error: null })), error: null };
  } }) } } as unknown as Parameters<typeof signStoragePathsBatch>[0];
  const urls = await signStoragePathsBatch(admin, "test-images", [null, "a.png", "a.png", undefined, "b.png"], 3600);
  assert.deepEqual(requested, ["a.png", "b.png"]);
  assert.deepEqual([...urls], [["a.png", "signed:a.png"], ["b.png", "signed:b.png"]]);
});

await check("signed URL mapping uses paths, so missing results cannot shift neighbors", async () => {
  const admin = { storage: { from: () => ({ createSignedUrls: async () => ({ data: [
    { path: "c.png", signedUrl: "signed:c", error: null },
    { path: "a.png", signedUrl: "signed:a", error: null },
    { path: "b.png", signedUrl: "", error: "missing" },
  ], error: null }) }) } } as unknown as Parameters<typeof signStoragePathsBatch>[0];
  const urls = await signStoragePathsBatch(admin, "test-images", ["a.png", "b.png", "c.png"], 3600);
  assert.equal(urls.get("a.png"), "signed:a");
  assert.equal(urls.get("b.png"), undefined);
  assert.equal(urls.get("c.png"), "signed:c");
});

for (const [name, source] of [["test editor", editor], ["test preview", preview], ["assignment snapshot", assignment], ["attempt review", attempt]] as const) {
  await check(`${name} uses batch signing`, () => {
    assert.match(source, /signStoragePathsBatch\([\s\S]*"test-images"/);
    assert.doesNotMatch(source, /createSignedUrl\(/);
  });
}

await check("materials batch only multi-item surfaces", () => {
  assert.match(materialApi, /signStoragePathsBatch\(admin, "materials"/);
  assert.match(materialDetail, /createSignedUrl\(material\.storage_path,15\*60\)/);
  assert.match(materialActions, /createSignedUrl\(data\.storage_path, 15 \* 60\)/);
});

await check("material library omits unused private storage metadata", () => {
  assert.doesNotMatch(materialLoader, /storage_path|original_file_name|storagePath/);
});

await check("import success is bounded to four concurrent uploads and keeps result order", async () => {
  let active = 0; let maximum = 0;
  const results = await runBoundedImportUploads([...Array(12).keys()], async (item) => {
    active += 1; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return `path-${item}`;
  });
  assert.equal(TEST_IMPORT_UPLOAD_CONCURRENCY, 4);
  assert.equal(maximum, 4);
  assert.deepEqual(results, [...Array(12).keys()].map((item) => `path-${item}`));
});

await check("upload failure drains in-flight workers before cleanup can begin", async () => {
  let active = 0; let maximum = 0; let started = 0;
  await assert.rejects(runBoundedImportUploads([...Array(12).keys()], async (item) => {
    active += 1; started += 1; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, item === 1 ? 2 : 10));
    active -= 1;
    if (item === 1) throw new Error("upload failed");
    return item;
  }), /upload failed/);
  assert.equal(maximum, 4);
  assert.equal(started, 4);
  assert.equal(active, 0);
});

await check("client import uses the bounded route pool with visible progress", () => {
  assert.match(modal, /runBoundedImportUploads\(value\.images/);
  assert.match(modal, /fetch\("\/api\/admin\/test-import-image"/);
  assert.match(modal, /Загружено \$\{completed\} из \$\{total\}/);
  assert.doesNotMatch(modal, /uploadTestImportImage|for \(const image of value\.images\)/);
});

await check("failure prevents finalize and invokes existing cleanup after pool settlement", () => {
  const pool = modal.indexOf("await runBoundedImportUploads");
  const finalize = modal.indexOf("await finishTestImport");
  const cleanup = modal.indexOf("await cancelTestImport");
  assert.ok(pool >= 0 && finalize > pool && cleanup > finalize);
  assert.match(modal, /catch \(error\)[\s\S]*cancelTestImport/);
});

await check("image-to-question mapping remains index-stable", () => {
  assert.match(modal, /value\.images\.map\(\(item, index\) => \(\{ filename: item\.filename, path: paths\[index\] \}\)\)/);
  assert.match(importActions, /required\.size !== refs\.length/);
  assert.match(importActions, /listed\.paths\.length !== suppliedPaths\.size/);
});

await check("upload route preserves ADMIN, token, session, draft and storage-prefix checks", () => {
  assert.match(uploadRoute, /uploadTestImportImageRequest/);
  assert.match(uploadRoute, /MAX_IMPORT_IMAGE_REQUEST_BYTES = 12 \* 1024 \* 1024/);
  assert.match(uploadRoute, /content-length/);
  assert.match(importSession, /role === "ADMIN"/);
  assert.match(importSession, /verifyImportToken/);
  assert.match(importSession, /test_import_sessions/);
  assert.match(importSession, /created_by", adminId/);
  assert.match(importSession, /importStoragePrefix\(payload\)/);
});

await check("existing cleanup token and DB-first lifecycle remain intact", () => {
  assert.match(importActions, /begin_test_import_atomic/);
  assert.match(importActions, /cleanupImport/);
  assert.match(importActions, /saveTestEditor[\s\S]*test_import_sessions/);
  assert.match(importSession, /createHmac\("sha256"/);
  assert.match(importSession, /timingSafeEqual/);
});

await check("AUDIT-03, AUDIT-16 and all applied migrations are untouched", () => {
  execFileSync("git", ["diff", "--quiet", baseline, "--", "src/lib/tests/build-test-snapshot.ts", "src/components/student/tests/intent-prefetch-link.tsx", "supabase"]);
});

console.log(`Admin media performance: ${passed} checks passed. No SQL, browser, Storage or database mutations used.`);
