import { notFound } from "next/navigation";
import { loadStudentMaterialLibrary } from "@/lib/materials/student-material-library";
import StudentMaterialsExplorer from "./student-materials-explorer";

export default async function StudentMaterialsPage({ studentId, folderId, query = "" }: { studentId: string; folderId?: string; query?: string }) {
  const library = await loadStudentMaterialLibrary(studentId);
  if (folderId && !library.folders.some((item) => item.id === folderId)) notFound();
  return <StudentMaterialsExplorer folders={library.folders} materials={library.materials} initialFolderId={folderId ?? null} initialQuery={query}/>;
}
