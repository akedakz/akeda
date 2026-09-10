import type { createAdminClient } from "@/lib/supabase/admin";

type PrivateStorageBucket = "materials" | "test-images";
type SignedUrlItem = { path?: string | null; signedUrl?: string | null; error?: unknown };

export function uniqueStoragePaths(paths: readonly (string | null | undefined)[]) {
  return [...new Set(paths.filter((path): path is string => typeof path === "string" && path.length > 0))];
}

export function mapSignedStorageUrls(requestedPaths: readonly string[], items: readonly SignedUrlItem[]) {
  const requested = new Set(requestedPaths);
  const urls = new Map<string, string>();
  for (const item of items) {
    if (!item.error && typeof item.path === "string" && requested.has(item.path) && item.signedUrl && !urls.has(item.path)) urls.set(item.path, item.signedUrl);
  }
  return urls;
}

export async function signStoragePathsBatch(
  admin: ReturnType<typeof createAdminClient>,
  bucket: PrivateStorageBucket,
  paths: readonly (string | null | undefined)[],
  expiresIn: number,
) {
  const uniquePaths = uniqueStoragePaths(paths);
  if (!uniquePaths.length) return new Map<string, string>();
  const result = await admin.storage.from(bucket).createSignedUrls(uniquePaths, expiresIn);
  if (result.error) {
    console.error("Не удалось подписать batch Storage paths:", { bucket, name: result.error.name, message: result.error.message });
    return new Map<string, string>();
  }
  return mapSignedStorageUrls(uniquePaths, result.data ?? []);
}
