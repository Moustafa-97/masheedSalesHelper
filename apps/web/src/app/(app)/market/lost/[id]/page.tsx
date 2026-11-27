"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { LostDealForm } from "@/components/market-forms";
import { Button, Muted, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useLostDeal } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";

export default function LostDealPage() {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const { data: deal, isLoading } = useLostDeal(id);
  if (isLoading || !deal) return <Muted>{t("loading")}</Muted>;
  const remove = async () => {
    if (!window.confirm(t("deleteLostDealConfirm"))) return;
    await api(`/lost-deals/${id}`, { method: "DELETE" });
    for (const key of ["market-prices", "lost-deals", "market-analysis"]) qc.invalidateQueries({ queryKey: [key] });
    router.push("/market/lost");
  };
  return (
    <>
      <PageHeader
        title={deal.client.name}
        subtitle={`${t("lostDeal")} · ${deal.createdBy}`}
        actions={<Button variant="ghost" onClick={remove}>{t("delete")}</Button>}
      />
      <LostDealForm initial={deal} onSaved={() => router.push("/market/lost")} />
    </>
  );
}
