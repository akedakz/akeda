import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageShell, PageHeader, PageContent } from "@/components/page-layout/page-layout";
import { getActiveStudentContext, loadAccessibleMaterial } from "@/lib/materials/student-material-library";

export default async function TextMaterialPage({ params }: { params: Promise<{ materialId: string }> }) {
  const context = await getActiveStudentContext();
  if (!context) redirect("/login");
  const { materialId } = await params;
  const accessible = await loadAccessibleMaterial(context.studentId, materialId);
  if (!accessible || accessible.raw.type !== "TEXT") notFound();
  const { data, error } = await context.admin.from("materials").select("text_content").eq("id", materialId).eq("type", "TEXT").single();
  if (error || !data) notFound();
  return <PageShell>
    <Link href="/student/materials">← К материалам</Link>
    <PageHeader title={accessible.safe.title} description={accessible.safe.description ?? undefined}/>
    <PageContent><article style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.75 }}>{data.text_content}</article></PageContent>
  </PageShell>;
}
