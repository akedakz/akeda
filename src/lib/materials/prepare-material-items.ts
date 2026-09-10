import "server-only";
import type { MaterialType } from "@/app/admin/materials/actions";
import type { MaterialItem } from "@/components/materials/material-card";
import { signStoragePathsBatch } from "@/lib/storage/sign-storage-paths-batch";
import { createAdminClient } from "@/lib/supabase/admin";

export type MaterialRow = { id:string;type:MaterialType;title:string;description:string|null;storage_path:string|null;original_file_name:string|null;file_size:number|null;external_url:string|null;created_at:string };
export async function prepareMaterialItems(admin:ReturnType<typeof createAdminClient>,rows:MaterialRow[]):Promise<MaterialItem[]>{
  const urls=await signStoragePathsBatch(admin,"materials",rows.map(row=>row.type==="FILE"?row.storage_path:null),15*60);
  return rows.map(row=>({id:row.id,type:row.type,title:row.title,description:row.description,file_size:row.file_size,external_url:row.external_url,created_at:row.created_at,signedUrl:row.storage_path?urls.get(row.storage_path)??null:null}));
}
