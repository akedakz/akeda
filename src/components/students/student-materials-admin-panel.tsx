import StudentMaterialAccessList from "./student-material-access-list";
import type { StudentFolderAccessItem, StudentMaterialAccessItem, StudentMaterialViewItem } from "./student-material-types";
import styles from "./student-materials-admin-panel.module.css";

export default function StudentMaterialsAdminPanel({ studentId, folders, materials, viewed, loadError, viewedLoadError }: { studentId: string; folders: StudentFolderAccessItem[]; materials: StudentMaterialAccessItem[]; viewed: StudentMaterialViewItem[]; loadError?: string; viewedLoadError?: string }) {
  return <div className={styles.layout}>
    <details className={styles.viewed}>
      <summary>Просмотрено</summary>
      {viewedLoadError ? <p className={styles.error}>{viewedLoadError}</p> : viewed.length ? <div>{viewed.map((item) => <div className={styles.row} key={item.materialId}><span>{item.title}</span><time dateTime={item.lastOpenedAt}>{item.lastOpenedLabel}</time></div>)}</div> : <p>Ученик пока не открывал материалы.</p>}
    </details>
    <StudentMaterialAccessList studentId={studentId} folders={folders} materials={materials} loadError={loadError}/>
  </div>;
}
