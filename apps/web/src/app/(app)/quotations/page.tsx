"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card, Input, Muted, PageHeader, Select } from "@/components/ui";
import { useClients, useQuotations } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { formatMoney } from "@/lib/orders";
import { quoteTone } from "@/lib/quotation";
import type { QuotationStatus } from "@/lib/types";

const STATUSES: QuotationStatus[] = ["DRAFT", "SENT", "ACCEPTED", "LOST"];

export default function QuotationsPage() {
  const { t } = useI18n();
  const [filters, setFilters] = useState<{ clientId?: string; status?: string; q?: string }>({});
  const set = (k: keyof typeof filters, v: string) => setFilters((f) => ({ ...f, [k]: v || undefined }));
  const { data: list = [], isLoading } = useQuotations(filters);
  const { data: clients = [] } = useClients();

  return (
    <>
      <PageHeader
        title={t("quotations")}
        subtitle={list.length ? `${list.length}` : undefined}
        actions={
          <Link href="/quotations/new">
            <Button>{t("newQuotation")}</Button>
          </Link>
        }
      />
      <Card className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-3">
        <Input label={t("search")} value={filters.q ?? ""} onChange={(e) => set("q", e.target.value)} type="search" className="col-span-2 lg:col-span-1" />
        <Select label={t("client")} value={filters.clientId ?? ""} onChange={(e) => set("clientId", e.target.value)}>
          <option value="">{t("all")}</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select label={t("status")} value={filters.status ?? ""} onChange={(e) => set("status", e.target.value)}>
          <option value="">{t("allStatuses")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`qStatus.${s}`)}</option>)}
        </Select>
      </Card>
      {isLoading && <Muted>{t("loading")}</Muted>}
      {!isLoading && !list.length && <Muted>{t("noQuotations")}</Muted>}
      <ul className="flex flex-col gap-2">
        {list.map((q) => (
          <li key={q.id}>
            <Link href={`/quotations/${q.id}`}>
              <Card className="flex flex-wrap items-center justify-between gap-2 transition hover:ring-2 hover:ring-brand-100">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <bdi className="font-bold">{q.number}</bdi>
                    <Badge tone={quoteTone(q.status)}>{t(`qStatus.${q.status}`)}</Badge>
                  </div>
                  <div className="truncate text-sm text-muted">
                    {q.client.name}
                    {q.client.status === "PROSPECT" && ` (${t("status.PROSPECT")})`} · {q.items.join("، ")}
                  </div>
                </div>
                <div className="text-end text-sm">
                  <bdi className="font-bold">{formatMoney(q.totals.total)}</bdi>
                  <div className="text-xs text-muted"><bdi>{q.date}</bdi></div>
                </div>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
