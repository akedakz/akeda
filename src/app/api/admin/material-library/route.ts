import { NextResponse } from "next/server";
import type { MaterialType } from "@/app/admin/materials/actions";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { sortLibraryItems } from "@/lib/library-sort";
import { signStoragePathsBatch } from "@/lib/storage/sign-storage-paths-batch";
import { createAdminClient } from "@/lib/supabase/admin";

type Folder = { id: string; parent_id: string | null; name: string; created_at: string };
type Material = { id: string; type: MaterialType; title: string; description: string | null; storage_path: string | null; file_size: number | null; external_url: string | null; created_at: string };
function log(context: string, error: { code?: string; message: string; details?: string; hint?: string }) { console.error(context, { code: error.code, message: error.message, details: error.details, hint: error.hint }); }

function breadcrumb(folders: Folder[], folder: Folder) {
  const byId = new Map(folders.map((item) => [item.id, item]));
  const chain: { id: string; name: string }[] = []; const visited = new Set<string>(); let current: Folder | null = folder;
  for (let depth = 0; current && depth < 50; depth += 1) {
    if (visited.has(current.id)) throw new Error("folder_cycle"); visited.add(current.id); chain.unshift({ id: current.id, name: current.name });
    if (!current.parent_id) return chain;
    current = byId.get(current.parent_id) ?? null; if (!current) throw new Error("folder_not_found");
  }
  throw new Error("folder_depth");
}

export async function GET(request: Request) {
  const current = await getCurrentProfile(); if (!current || current.profile?.role !== "ADMIN") return NextResponse.json({ message: "Недостаточно прав." }, { status: 403 });
  const folderId = new URL(request.url).searchParams.get("folderId")?.trim() || null; const admin = createAdminClient(); let path: { id: string; name: string }[] = [];
  const allFoldersResult = await admin.from("material_folders").select("id, parent_id, name, created_at");
  if (allFoldersResult.error) { log("Не удалось загрузить папки материалов:", allFoldersResult.error); return NextResponse.json({ message: "Не удалось загрузить библиотеку материалов." }, { status: 500 }); }
  const allFolders = (allFoldersResult.data ?? []) as Folder[];
  if (folderId) {
    const folder = allFolders.find((item) => item.id === folderId); if (!folder) return NextResponse.json({ message: "Папка не найдена." }, { status: 404 });
    try { path = breadcrumb(allFolders, folder); } catch (error) { console.error("Не удалось построить breadcrumb материалов:", error); return NextResponse.json({ message: "Не удалось загрузить путь папки." }, { status: 500 }); }
  }
  const materialResult = folderId ? await admin.from("materials").select("id, type, title, description, storage_path, file_size, external_url, created_at").eq("folder_id", folderId) : await admin.from("materials").select("id, type, title, description, storage_path, file_size, external_url, created_at").is("folder_id", null);
  if (materialResult.error) { log("Не удалось загрузить библиотеку материалов:", materialResult.error); return NextResponse.json({ message: "Не удалось загрузить библиотеку материалов." }, { status: 500 }); }
  const folders = sortLibraryItems(allFolders.filter((item) => item.parent_id === folderId), "created_desc", (item) => item.name, (item) => item.created_at);
  const materials = sortLibraryItems((materialResult.data ?? []) as Material[], "created_desc", (item) => item.title, (item) => item.created_at);
  const folderIds = folders.map((item) => item.id); const folderCounts = new Map<string, number>(); const materialCounts = new Map<string, number>();
  const [contents, signed] = await Promise.all([
    folderIds.length ? admin.from("materials").select("folder_id").in("folder_id", folderIds) : Promise.resolve({ data: [], error: null }),
    signStoragePathsBatch(admin, "materials", materials.map((item) => item.type === "FILE" ? item.storage_path : null), 15 * 60),
  ]);
  if (contents.error) { log("Не удалось загрузить счётчики папок:", contents.error); return NextResponse.json({ message: "Не удалось загрузить данные папок." }, { status: 500 }); }
  for (const row of allFolders) if (row.parent_id && folderIds.includes(row.parent_id)) folderCounts.set(row.parent_id, (folderCounts.get(row.parent_id) ?? 0) + 1);
  for (const row of contents.data ?? []) if (row.folder_id) materialCounts.set(row.folder_id, (materialCounts.get(row.folder_id) ?? 0) + 1);
  return NextResponse.json({ breadcrumb: path, folders: folders.map((item) => ({ id: item.id, name: item.name, createdAt: item.created_at, childFolderCount: folderCounts.get(item.id) ?? 0, materialCount: materialCounts.get(item.id) ?? 0 })), materials: materials.map((item) => ({ id: item.id, type: item.type, title: item.title, description: item.description, fileSize: item.file_size, createdAt: item.created_at, openUrl: item.type === "FILE" && item.storage_path ? signed.get(item.storage_path) ?? null : item.type === "TEXT" ? `/admin/materials/${item.id}` : item.external_url, external: item.type !== "TEXT" })) });
}
