"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import { useTerms } from "@/components/market-bits";
import { Stat } from "@/components/order-bits";
import { Button, Card, Input, Muted, PageHeader } from "@/components/ui";
import { useMarketAnalysis } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { monthsAgo } from "@/lib/market";
import { formatMoney, today } from "@/lib/orders";

/** A labelled row with a bar proportional to its value. */
function Bars({
  rows,
}: {
  rows: { label: string; count: number; value: number }[];
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.label} className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between gap-2">
            <span>
              {r.label} <span className="text-xs text-muted">({r.count})</span>
            </span>
            <bdi className="font-semibold">{formatMoney(r.value)}</bdi>
          </div>
          <div className="h-2 rounded-full bg-canvas">
            <div
              className="h-2 rounded-full bg-danger"
              style={{ width: `${Math.max((r.value / max) * 100, 2)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function MarketAnalysisPage() {
  const { t } = useI18n();
  const terms = useTerms();
  const [from, setFrom] = useState(monthsAgo(6));
  const [to, setTo] = useState(today());
  const { data: a, isLoading } = useMarketAnalysis({ from, to });

  return (
    <>
      <PageHeader
        title={t("marketAnalysis")}
        actions={
          <>
            <Link href="/market/prices">
              <Button variant="secondary">+ {t("addMarketPrice")}</Button>
            </Link>
            <Link href="/market/lost/new">
              <Button variant="secondary">+ {t("newLostDeal")}</Button>
            </Link>
          </>
        }
      />
      <Card className="flex flex-wrap items-end gap-2">
        {[3, 6, 12].map((m) => (
          <Button
            key={m}
            variant={
              from === monthsAgo(m) && to === today() ? "primary" : "secondary"
            }
            onClick={() => (setFrom(monthsAgo(m)), setTo(today()))}
          >
            {t("lastMonths", { count: m })}
          </Button>
        ))}
        <Input
          label={t("from")}
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="w-40"
        />
        <Input
          label={t("to")}
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="w-40"
        />
      </Card>

      {isLoading || !a ? (
        <Muted>{t("loading")}</Muted>
      ) : (
        <>
          <Card className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t("winRate")} strong>
              {a.quotations.winRate === null ? "—" : `${a.quotations.winRate}%`}
            </Stat>
            <Stat label={t("quotesWonLost")}>
              <bdi>
                {a.quotations.won} / {a.quotations.lost}
              </bdi>
            </Stat>
            <Stat label={t("lostValue")}>{formatMoney(a.lost.value)}</Stat>
            <Stat label={t("lostCount")}>{a.lost.count}</Stat>
          </Card>

          <Card className="flex flex-col gap-3 p-0">
            <div className="px-4 pt-4">
              <h2 className="font-bold">{t("priceVsMarket")}</h2>
              <p className="text-xs text-muted">{t("priceVsMarketHint")}</p>
            </div>
            {a.items.length === 0 ? (
              <Muted>{t("noMarketPrices")}</Muted>
            ) : (
              <>
                <ul className="divide-y divide-line md:hidden">
                  {a.items.map((i) => (
                    <li
                      key={`${i.variantId ?? i.name}-${i.creditDays}`}
                      className="flex flex-col gap-1 px-4 py-3 text-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold">{i.name}</div>
                          <div className="text-xs text-muted">
                            {terms(i.creditDays)} · {t(`unit.${i.unit}`)}
                          </div>
                        </div>
                        {i.diffPct !== null && (
                          <bdi
                            className={clsx(
                              "font-bold",
                              i.diffPct > 0 ? "text-danger" : "text-ok",
                            )}
                          >
                            {i.diffPct > 0 ? "+" : ""}
                            {i.diffPct}%
                          </bdi>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <div className="text-muted">{t("ourAccepted")}</div>
                          <bdi className="font-semibold">
                            {i.ours ? formatMoney(i.ours.price) : "—"}
                          </bdi>
                        </div>
                        <div>
                          <div className="text-muted">{t("latestMarket")}</div>
                          <bdi className="font-semibold">
                            {formatMoney(i.market.price)}
                          </bdi>{" "}
                          <span className="text-muted">
                            {i.market.competitor}
                          </span>
                        </div>
                        <div>
                          <div className="text-muted">{t("lowestMarket")}</div>
                          <bdi>{formatMoney(i.lowest.price)}</bdi>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[42rem] text-sm">
                    <thead className="bg-canvas text-xs text-muted">
                      <tr>
                        <th className="px-4 py-2 text-start">{t("item")}</th>
                        <th className="px-2 py-2 text-start">
                          {t("paymentTerms")}
                        </th>
                        <th className="px-2 py-2 text-start">
                          {t("ourAccepted")}
                        </th>
                        <th className="px-2 py-2 text-start">
                          {t("latestMarket")}
                        </th>
                        <th className="px-2 py-2 text-start">
                          {t("lowestMarket")}
                        </th>
                        <th className="px-4 py-2 text-start">
                          {t("difference")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {a.items.map((i) => (
                        <tr key={`${i.variantId ?? i.name}-${i.creditDays}`}>
                          <td className="px-4 py-2">
                            <div className="font-semibold">{i.name}</div>
                            <div className="text-xs text-muted">
                              {t(`unit.${i.unit}`)} ·{" "}
                              {t("pricesCount", { count: i.count })}
                            </div>
                          </td>
                          <td className="px-2 py-2">{terms(i.creditDays)}</td>
                          <td className="px-2 py-2">
                            {i.ours ? (
                              <>
                                <bdi className="font-semibold">
                                  {formatMoney(i.ours.price)}
                                </bdi>
                                <div className="text-xs text-muted">
                                  {i.ours.client} · <bdi>{i.ours.date}</bdi>
                                </div>
                              </>
                            ) : (
                              <span className="text-xs text-muted">
                                {t("noAcceptedAtTerms")}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <bdi className="font-semibold">
                              {formatMoney(i.market.price)}
                            </bdi>
                            <div className="text-xs text-muted">
                              {i.market.competitor ?? "—"} ·{" "}
                              <bdi>{i.market.date}</bdi>
                            </div>
                          </td>
                          <td className="px-2 py-2">
                            <bdi>{formatMoney(i.lowest.price)}</bdi>
                            <div className="text-xs text-muted">
                              {i.lowest.competitor ?? "—"}
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            {i.diffPct === null ? (
                              "—"
                            ) : (
                              <span
                                className={clsx(
                                  "font-bold",
                                  i.diffPct > 0 ? "text-danger" : "text-ok",
                                )}
                              >
                                <bdi>
                                  {i.diffPct > 0 ? "+" : ""}
                                  {i.diffPct}%
                                </bdi>
                                <div className="text-xs font-normal">
                                  {i.diffPct > 0
                                    ? t("aboveMarket")
                                    : i.diffPct < 0
                                      ? t("belowMarket")
                                      : t("atMarket")}
                                </div>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>

          <div className="grid gap-4 md:grid-cols-3">
            <Card className="flex flex-col gap-3">
              <h2 className="font-bold">{t("lostByMonth")}</h2>
              {a.lost.byMonth.length ? (
                <Bars
                  rows={a.lost.byMonth.map((r) => ({ ...r, label: r.key }))}
                />
              ) : (
                <Muted>{t("noLostDeals")}</Muted>
              )}
            </Card>
            <Card className="flex flex-col gap-3">
              <h2 className="font-bold">{t("lostByReason")}</h2>
              {a.lost.byReason.length ? (
                <Bars
                  rows={a.lost.byReason.map((r) => ({
                    ...r,
                    label: t(`lostReason.${r.key}`),
                  }))}
                />
              ) : (
                <Muted>{t("noLostDeals")}</Muted>
              )}
            </Card>
            <Card className="flex flex-col gap-3">
              <h2 className="font-bold">{t("lostByCompetitor")}</h2>
              {a.lost.byCompetitor.length ? (
                <Bars
                  rows={a.lost.byCompetitor.map((r) => ({
                    ...r,
                    label: r.key || t("unknownCompetitor"),
                  }))}
                />
              ) : (
                <Muted>{t("noLostDeals")}</Muted>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
