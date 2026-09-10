import { PageContent, PageContentLoading, PageShell } from "@/components/page-layout/page-layout";

export default function StudentLoading() {
  return <PageShell><PageContent><PageContentLoading label="Открываем страницу ученика"/></PageContent></PageShell>;
}
