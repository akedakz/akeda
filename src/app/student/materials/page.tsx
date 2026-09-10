import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageContent, PageContentLoading, PageHeader, PageShell } from "@/components/page-layout/page-layout";
import StudentMaterialsPage from "@/components/student/materials/student-materials-page";
import { getActiveStudentContext } from "@/lib/materials/student-material-library";

export default function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) { return <PageShell><PageHeader title="Материалы" description="Файлы и ссылки от преподавателя."/><PageContent><Suspense fallback={<PageContentLoading label="Загружаем материалы"/>}><MaterialsContent searchParams={searchParams}/></Suspense></PageContent></PageShell>; }
async function MaterialsContent({ searchParams }: { searchParams: Promise<{ q?: string }> }) { const context = await getActiveStudentContext(); if (!context) redirect("/student"); const { q } = await searchParams; return <StudentMaterialsPage studentId={context.studentId} query={q ?? ""}/>; }
