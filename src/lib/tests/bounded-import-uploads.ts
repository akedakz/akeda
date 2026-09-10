export const TEST_IMPORT_UPLOAD_CONCURRENCY = 4;

export async function runBoundedImportUploads<Item, Result>(
  items: readonly Item[],
  upload: (item: Item, index: number) => Promise<Result>,
  onProgress?: (completed: number, total: number) => void,
) {
  if (!items.length) return [] as Result[];
  const results = new Array<Result>(items.length);
  let cursor = 0;
  let completed = 0;
  let failed = false;
  let failure: unknown;

  const worker = async () => {
    while (!failed) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = await upload(items[index], index);
        completed += 1;
        onProgress?.(completed, items.length);
      } catch (error) {
        if (!failed) failure = error;
        failed = true;
      }
    }
  };

  const workerCount = Math.min(TEST_IMPORT_UPLOAD_CONCURRENCY, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (failed) throw failure;
  return results;
}
