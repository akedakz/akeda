import type { MaterialItem } from "./material-card";
import MaterialFolderCard, { type MaterialFolderItem } from "./material-folder-card";
import MaterialList from "./material-list";
import type { LibrarySort } from "@/lib/library-sort";
import styles from "@/app/admin/materials/materials.module.css";

export default function MaterialLibraryContent({ folders, materials, emptyText, sort, onNavigate, onFolderAction }: { folders: MaterialFolderItem[]; materials: MaterialItem[]; emptyText: string; sort: LibrarySort; onNavigate?: (id:string)=>void; onFolderAction?: (kind:"rename"|"move"|"delete",folder:MaterialFolderItem)=>void }) {
  if (!folders.length && !materials.length) return <p className={styles.empty}>{emptyText}</p>;
  return <>{folders.length > 0 && <section className={styles.zone}><div className={styles.zoneHeading}><h2>Папки</h2><span>{folders.length}</span></div><div className={styles.folderGrid}>{folders.map((folder) => <MaterialFolderCard folder={folder} sort={sort} onNavigate={onNavigate} onAction={onFolderAction} key={folder.id}/>)}</div></section>}{materials.length > 0 && <section className={styles.zone}><div className={styles.zoneHeading}><h2>Материалы</h2><span>{materials.length}</span></div><MaterialList materials={materials}/></section>}</>;
}
