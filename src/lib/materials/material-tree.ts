import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;
type FolderRow = { id: string; parent_id: string | null; name: string };

export async function loadFolderAncestors(admin: AdminClient, folderId: string, maxDepth = 100) {
  const chain: FolderRow[] = [];
  const visited = new Set<string>();
  let currentId: string | null = folderId;
  for (let depth = 0; currentId && depth < maxDepth; depth += 1) {
    if (visited.has(currentId)) return { data: null, error: new Error("Обнаружен цикл папок.") };
    visited.add(currentId);
    const { data, error } = await admin.from("material_folders").select("id, parent_id, name").eq("id", currentId).maybeSingle();
    if (error) return { data: null, error };
    if (!data) return { data: null, error: new Error("Папка не найдена.") };
    const folder = data as FolderRow;
    chain.push(folder);
    currentId = folder.parent_id;
  }
  if (currentId) return { data: null, error: new Error("Превышена допустимая глубина папок.") };
  return { data: chain, error: null };
}

export async function collectFolderTreeIds(admin: AdminClient, rootId: string, maxDepth = 100) {
  const visited = new Set<string>([rootId]);
  let frontier = [rootId];
  for (let depth = 0; frontier.length && depth < maxDepth; depth += 1) {
    const { data, error } = await admin.from("material_folders").select("id, parent_id").in("parent_id", frontier);
    if (error) return { data: null, error };
    const next: string[] = [];
    for (const row of (data ?? []) as { id: string; parent_id: string | null }[]) {
      if (visited.has(row.id)) return { data: null, error: new Error("Обнаружен цикл папок.") };
      visited.add(row.id); next.push(row.id);
    }
    frontier = next;
  }
  if (frontier.length) return { data: null, error: new Error("Превышена допустимая глубина папок.") };
  return { data: [...visited], error: null };
}

export function chunks<T>(items: T[], size = 500) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}
