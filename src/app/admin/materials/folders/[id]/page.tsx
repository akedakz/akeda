import { notFound } from "next/navigation";
import { parseLibrarySort } from "@/lib/library-sort";
import { loadMaterialLibrary } from "@/lib/materials/load-material-library";
import MaterialLibraryExplorer from "../../material-library-explorer";
import styles from "../../materials.module.css";

export default async function MaterialFolderPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){const[{id},query]=await Promise.all([params,searchParams]);const library=await loadMaterialLibrary();if(library.error)return <div className={styles.queryError}>Не удалось загрузить библиотеку материалов.{process.env.NODE_ENV==="development"&&<code>{library.error.code||"Supabase error"}: {library.error.message}</code>}</div>;if(!library.folders.some(folder=>folder.id===id))notFound();return <MaterialLibraryExplorer initialFolderId={id} initialFolders={library.folders} initialMaterials={library.materials} sort={parseLibrarySort(query.sort)}/>;}
