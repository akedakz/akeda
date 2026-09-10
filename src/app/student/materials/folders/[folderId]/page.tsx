import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageContent, PageContentLoading, PageHeader, PageShell } from "@/components/page-layout/page-layout";
import StudentMaterialsPage from "@/components/student/materials/student-materials-page";
import { getActiveStudentContext } from "@/lib/materials/student-material-library";

export default function Page(props: { params: Promise<{ folderId: string }>; searchParams: Promise<{ q?: string }> }) { return <PageShell><PageHeader title="Материалы" description="Файлы и ссылки от преподавателя."/><PageContent><Suspense fallback={<PageContentLoading label="Загружаем папку"/>}><FolderContent {...props}/></Suspense></PageContent></PageShell>; }
async function FolderContent({ params, searchParams }: { params: Promise<{ folderId: string }>; searchParams: Promise<{ q?: string }> }) { const context = await getActiveStudentContext(); if (!context) redirect("/student"); const [{ folderId }, { q }] = await Promise.all([params, searchParams]); if (!/^[0-9a-f-]{36}$/i.test(folderId)) redirect("/student/materials"); const exists = await context.admin.from("material_folders").select("id").eq("id", folderId).maybeSingle(); if (!exists.data) redirect("/student/materials"); return <StudentMaterialsPage studentId={context.studentId} folderId={folderId} query={q ?? ""}/>; }
