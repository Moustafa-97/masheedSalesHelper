"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { QuotationForm } from "@/components/quotation-form";
import { PageHeader } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

function NewQuotation() {
  const { t } = useI18n();
  const params = useSearchParams();
  return (
    <>
      <PageHeader title={t("newQuotation")} />
      <QuotationForm presetClientId={params.get("clientId") ?? undefined} />
    </>
  );
}

export default function NewQuotationPage() {
  return (
    <Suspense>
      <NewQuotation />
    </Suspense>
  );
}
