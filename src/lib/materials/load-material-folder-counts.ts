import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

type QueryError = { code?: string; message: string; details?: string; hint?: string };
export async function loadMaterialFolderCounts(admin: ReturnType<typeof createAdminClient>, ids: string[]) {
  const folderCounts = new Map<string,number>(), materialCounts = new Map<string,number>();
  if (!ids.length) return { folderCounts, materialCounts, error: null as QueryError | null };
  const [folders,materials] = await Promise.all([admin.from("material_folders").select("parent_id").in("parent_id",ids),admin.from("materials").select("folder_id").in("folder_id",ids)]);
  if(folders.error) console.error("Не удалось подсчитать подпапки материалов:",{code:folders.error.code,message:folders.error.message,details:folders.error.details,hint:folders.error.hint});
  if(materials.error) console.error("Не удалось подсчитать материалы:",{code:materials.error.code,message:materials.error.message,details:materials.error.details,hint:materials.error.hint});
  for(const row of folders.data??[]) if(row.parent_id) folderCounts.set(row.parent_id,(folderCounts.get(row.parent_id)??0)+1);
  for(const row of materials.data??[]) if(row.folder_id) materialCounts.set(row.folder_id,(materialCounts.get(row.folder_id)??0)+1);
  return { folderCounts,materialCounts,error:folders.error??materials.error };
}
