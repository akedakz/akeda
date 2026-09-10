import type { MaterialType } from "@/app/admin/materials/actions";

export type MaterialLibraryFolder = { id: string; name: string; createdAt: string; childFolderCount: number; materialCount: number };
export type MaterialLibraryItem = { id: string; type: MaterialType; title: string; description: string | null; fileSize: number | null; createdAt: string; openUrl: string | null; external: boolean };
export type MaterialLibraryLevel = { breadcrumb: { id: string; name: string }[]; folders: MaterialLibraryFolder[]; materials: MaterialLibraryItem[] };
export type MaterialAccessActionResult = { ok: boolean; message: string };
export type StudentFolderAccessItem = { accessId: string; folderId: string; name: string; createdAt: string };
export type StudentMaterialAccessItem = MaterialLibraryItem & { accessId: string; materialId: string; grantedAt: string };
export type StudentMaterialViewItem = { materialId: string; title: string; lastOpenedAt: string; lastOpenedLabel: string };
