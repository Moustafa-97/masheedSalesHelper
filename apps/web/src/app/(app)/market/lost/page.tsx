"use client";

import Link from "next/link";
import { useState } from "react";
import { isolate } from "@/components/credit-panel";
import { useTerms } from "@/components/market-bits";
import { Badge, Button, Card, Input, Muted, PageHeader, Select } from "@/components/ui";
import { useCompetitors, useLostDeals } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { LOST_REASONS, monthsAgo } from "@/lib/market";
import { formatMoney, formatQty, today } from "@/lib/orders";

export default function LostDealsPage() {
  const { t } = useI18n();
  const terms = useTerms();
  const [from, setFrom] = useState(monthsAgo(6));
  const [to, setTo] = useState(today());
  const [reason, setReason] = useState("");
  const [competitorId, setCompetitorId] = useState("");
  const { data: lost = [], isLoading } = useLostDeals({ from, to, reason: reason || undefined, competitorId: competitorId || undefined });
  const { data: competitors = [] } = useCompetitors();
  const total = lost.reduce((s, e) => s + e.value, 0);

  return (
    <>
      <PageHeader
        title={t("lostDeals")}
        subtitle={lost.length ? t("lostTotal", { count: lost.length, value: isolate(formatMoney(total)) }) : undefined}
        actions={
          <Link href="/market/lost/new">
            <Button>+ {t("newLostDeal")}</Button>
          </Link>
        }
      />
      <Card className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Input label={t("from")} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label={t("to")} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Select label={t("reason")} value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">{t("all")}</option>
          {LOST_REASONS.map((r) => <option key={r} value={r}>{t(`lostReason.${r}`)}</option>)}
        </Select>
        <Select label={t("competitor")} value={competitorId} onChange={(e) => setCompetitorId(e.target.value)}>
          <option value="">{t("all")}</option>
          {competitors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Card>

      {isLoading ? (
        <Muted>{t("loading")}</Muted>
      ) : lost.length === 0 ? (
        <Muted>{t("noLostDeals")}</Muted>
      ) : (
        <ul className="flex flex-col gap-2">
          {lost.map((e) => (
            <li key={`${e.kind}-${e.id}`}>
              <Link href={e.kind === "QUOTATION" ? `/quotations/${e.id}` : `/market/lost/${e.id}`}>
                <Card className="flex flex-col gap-2 hover:ring-2 hover:ring-brand-100">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">{e.client.name}</div>
                      <div className="text-xs text-muted">
                        <bdi>{e.date}</bdi> · {e.kind === "QUOTATION" ? <bdi>{e.number}</bdi> : t("withoutQuotation")} · {e.createdBy}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge tone="danger">{t(`lostReason.${e.reason}`)}</Badge>
                      <bdi className="text-sm font-bold">{formatMoney(e.value)}</bdi>
                    </div>
                  </div>
                  {e.note && <p className="text-sm text-muted">{e.note}</p>}
                  <div className="flex flex-col gap-1 border-t border-line pt-2 text-sm">
                    {e.prices.map((p, i) => (
                      <div key={i} className="flex flex-wrap justify-between gap-2">
                        <span>
                          {p.name} · <bdi>{formatQty(p.qty)} {t(`unit.${p.unit}`)}</bdi>
                        </span>
                        <span className="text-xs">
                          {t("ourPrice")} <bdi className="font-semibold">{p.ours === null ? "—" : formatMoney(p.ours)}</bdi> ({terms(e.creditDays)})
                          {" · "}
                          {e.competitor?.name ?? t("competitor")} <bdi className="font-semibold text-danger">{p.theirs === null ? "—" : formatMoney(p.theirs)}</bdi> ({terms(e.competitorCreditDays)})
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
