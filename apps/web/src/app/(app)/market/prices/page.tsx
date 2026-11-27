"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useTerms } from "@/components/market-bits";
import { MarketPriceForm } from "@/components/market-forms";
import { Badge, Button, Card, Input, Muted, PageHeader, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { zoneName } from "@/lib/catalogue";
import { useCompetitors, useMarketPrices } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { monthsAgo } from "@/lib/market";
import { formatMoney, today } from "@/lib/orders";
import type { MarketPrice } from "@/lib/types";

export default function MarketPricesPage() {
  const { t, locale } = useI18n();
  const terms = useTerms();
  const qc = useQueryClient();
  const [from, setFrom] = useState(monthsAgo(6));
  const [to, setTo] = useState(today());
  const [q, setQ] = useState("");
  const [competitorId, setCompetitorId] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const { data: prices = [], isLoading } = useMarketPrices({ from, to, q: q || undefined, competitorId: competitorId || undefined });
  const { data: competitors = [] } = useCompetitors();

  const remove = async (p: MarketPrice) => {
    if (!window.confirm(t("deletePriceConfirm"))) return;
    await api(`/market-prices/${p.id}`, { method: "DELETE" });
    for (const key of ["market-prices", "market-analysis"]) qc.invalidateQueries({ queryKey: [key] });
  };

  return (
    <>
      <PageHeader
        title={t("marketPrices")}
        subtitle={t("marketPricesHint")}
        actions={!adding && <Button onClick={() => setAdding(true)}>+ {t("addMarketPrice")}</Button>}
      />
      {adding && (
        <Card>
          <MarketPriceForm onDone={() => setAdding(false)} />
        </Card>
      )}
      <Card className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Input label={t("search")} value={q} onChange={(e) => setQ(e.target.value)} className="col-span-2 md:col-span-1" />
        <Select label={t("competitor")} value={competitorId} onChange={(e) => setCompetitorId(e.target.value)} className="col-span-2 md:col-span-1">
          <option value="">{t("all")}</option>
          {competitors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Input label={t("from")} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label={t("to")} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </Card>

      {isLoading ? (
        <Muted>{t("loading")}</Muted>
      ) : prices.length === 0 ? (
        <Muted>{t("noMarketPrices")}</Muted>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {prices.map((p) =>
              editing === p.id ? (
                <li key={p.id} className="p-4">
                  <MarketPriceForm initial={p} onDone={() => setEditing(null)} />
                </li>
              ) : (
                <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold">{p.name}</span>
                    <span className="text-xs text-muted">
                      {p.competitor?.name ?? "—"} · <bdi>{p.date}</bdi>
                      {p.zone && ` · ${zoneName(p.zone, locale)}`} · {p.createdBy}
                    </span>
                    {p.notes && <span className="text-xs text-muted">{p.notes}</span>}
                    <span className="flex flex-wrap gap-1">
                      <Badge tone={p.automatic ? "danger" : "info"}>{t(`priceSource.${p.source}`)}</Badge>
                      {p.quotation && (
                        <Link href={`/quotations/${p.quotation.id}`} className="text-xs text-brand-700 underline">
                          <bdi>{p.quotation.number}</bdi>
                        </Link>
                      )}
                      {p.lostDealId && (
                        <Link href={`/market/lost/${p.lostDealId}`} className="text-xs text-brand-700 underline">{t("lostDeal")}</Link>
                      )}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span>
                      <bdi className="text-lg font-bold">{formatMoney(p.price)}</bdi>
                      <span className="text-xs text-muted"> / {t(`unit.${p.unit}`)}</span>
                    </span>
                    <Badge tone={p.creditDays ? "warn" : "ok"}>{terms(p.creditDays)}</Badge>
                    {!p.automatic && (
                      <span className="flex gap-1">
                        <Button variant="ghost" className="min-h-8 px-2 text-xs" onClick={() => setEditing(p.id)}>{t("edit")}</Button>
                        <Button variant="ghost" className="min-h-8 px-2 text-xs" onClick={() => remove(p)}>{t("delete")}</Button>
                      </span>
                    )}
                  </div>
                </li>
              ),
            )}
          </ul>
        </Card>
      )}
    </>
  );
}
