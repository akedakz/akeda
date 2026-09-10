import type { Metadata } from "next";
import { PageContent, PageHeader, PageShell } from "@/components/page-layout/page-layout";
import FormulaEditorPlayground from "./formula-editor-playground";

export const metadata: Metadata = { title: "Formula Editor — NSP" };

export default function FormulaEditorPreviewPage() {
  return <PageShell><PageHeader title="Formula Editor" description="Внутренняя площадка для проверки визуального ввода школьных формул."/><PageContent><FormulaEditorPlayground/></PageContent></PageShell>;
}
