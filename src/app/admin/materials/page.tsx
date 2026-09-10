import type { Metadata } from "next";
import { PageContent,PageHeader,PageShell } from "@/components/page-layout/page-layout";
import { parseLibrarySort } from "@/lib/library-sort";
import { loadMaterialLibrary } from "@/lib/materials/load-material-library";
import MaterialLibraryExplorer from "./material-library-explorer";
import styles from "./materials.module.css";

export const metadata:Metadata={title:"Материалы — NSP",description:"Библиотека учебных материалов NSP."};
export default async function MaterialsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const sort=parseLibrarySort((await searchParams).sort);const library=await loadMaterialLibrary();if(library.error)return <PageShell><PageHeader title="Материалы" description="Управление библиотекой учебных материалов."/><PageContent><div className={styles.queryError}>Не удалось загрузить библиотеку материалов.{process.env.NODE_ENV==="development"&&<code>{library.error.code||"Supabase error"}: {library.error.message}</code>}</div></PageContent></PageShell>;return <MaterialLibraryExplorer initialFolderId={null} initialFolders={library.folders} initialMaterials={library.materials} sort={sort}/>;}
