import { NextResponse } from "next/server";
import { getActiveStudentContext, loadAccessibleMaterial } from "@/lib/materials/student-material-library";

export async function GET(_: Request, { params }: { params: Promise<{ materialId: string }> }) {
  const context = await getActiveStudentContext();
  if (!context) return NextResponse.redirect(new URL("/login", _.url));
  const { materialId } = await params;
  const material = await loadAccessibleMaterial(context.studentId, materialId);
  if (!material) return new NextResponse("Материал не найден", { status: 404 });

  let destination: string | null = null;
  if (material.raw.type === "FILE" && material.raw.storage_path) {
    const signed = await context.admin.storage.from("materials").createSignedUrl(material.raw.storage_path, 5 * 60);
    if (!signed.error) destination = signed.data.signedUrl;
  } else if (material.raw.type === "LINK" && material.raw.external_url) {
    try { const url = new URL(material.raw.external_url); if (url.protocol === "http:" || url.protocol === "https:") destination = url.toString(); } catch { destination = null; }
  }
  if (!destination) return new NextResponse("Не удалось открыть материал. Попробуйте ещё раз.", { status: 422 });

  const view = await context.admin.rpc("record_student_material_view", { p_student_id: context.studentId, p_material_item_id: materialId });
  if (view.error) console.error("Не удалось отметить открытие материала:", { code: view.error.code, message: view.error.message });
  return NextResponse.redirect(destination);
}
