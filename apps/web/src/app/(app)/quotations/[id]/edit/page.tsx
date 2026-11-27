"use client";

import { useParams } from "next/navigation";
import { QuotationForm } from "@/components/quotation-form";
import { Muted, PageHeader } from "@/components/ui";
import { useQuotation } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";

export default function EditQuotationPage() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const { data: q, isLoading } = useQuotation(id);
  if (isLoading || !q) return <Muted>{t("loading")}</Muted>;
  return (
    <>
      <PageHeader title={`${t("edit")} ${q.number}`} subtitle={q.client.name} />
      <QuotationForm initial={q} />
    </>
  );
}
