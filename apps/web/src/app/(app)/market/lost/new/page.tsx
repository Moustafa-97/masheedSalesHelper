"use client";

import { useRouter } from "next/navigation";
import { LostDealForm } from "@/components/market-forms";
import { PageHeader } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

export default function NewLostDealPage() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <>
      <PageHeader title={t("newLostDeal")} subtitle={t("newLostDealHint")} />
      <LostDealForm onSaved={() => router.push("/market/lost")} />
    </>
  );
}
