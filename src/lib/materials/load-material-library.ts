import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { MaterialType } from "@/app/admin/materials/actions";

export type MaterialLibraryFolder = { id: string; parentId: string | null; name: string; createdAt: string };
export type MaterialLibraryItem = { id:string;folderId:string|null;type:MaterialType;title:string;description:string|null;file_size:number|null;external_url:string|null;created_at:string;signedUrl:null };

export async function loadMaterialLibrary() {
  const admin = createAdminClient();
  const [folderResult, materialResult] = await Promise.all([
    admin.from("material_folders").select("id, parent_id, name, created_at"),
    admin.from("materials").select("id, folder_id, type, title, description, file_size, external_url, created_at"),
  ]);
  const error = folderResult.error ?? materialResult.error;
  if (error) console.error("Не удалось загрузить дерево материалов:", { code: error.code, message: error.message, details: error.details, hint: error.hint });
  const rows = (materialResult.data ?? []) as Array<{ id:string;folder_id:string|null;type:MaterialType;title:string;description:string|null;file_size:number|null;external_url:string|null;created_at:string }>;
  return {
    folders: (folderResult.data ?? []).map((folder) => ({ id: folder.id, parentId: folder.parent_id, name: folder.name, createdAt: folder.created_at })) as MaterialLibraryFolder[],
    materials: rows.map(({folder_id,...item}) => ({...item,folderId:folder_id,signedUrl:null})) as MaterialLibraryItem[],
    error,
  };
}
