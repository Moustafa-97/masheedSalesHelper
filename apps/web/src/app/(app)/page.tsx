"use client";

import clsx from "clsx";
import Link from "next/link";
import { StatusBadge } from "@/components/order-bits";
import { Card, PageHeader } from "@/components/ui";
import { formatNumber } from "@/lib/api";
import { useClients, useMe, useOrdersSummary, useVariants } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";

const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

export default function HomePage() {
  const { t } = useI18n();
  const { data: me } = useMe();
  const { data: clients = [] } = useClients();
  const { data: variants = [] } = useVariants();
  const { data: summary } = useOrdersSummary();

  const active = clients.filter((c) => c.status === "ACTIVE");
  const prospects = clients.filter((c) => c.status === "PROSPECT");
  const limits = active.reduce((sum, c) => sum + c.creditLimit, 0);

  const orderTiles = [
    { label: t("ordersOpen"), value: summary?.open ?? "—", href: "/orders?state=open", tone: "brand" },
    {
      label: t("needsUpdate"),
      value: summary?.staleCount ?? "—",
      href: "/orders?state=open",
      tone: summary?.staleCount ? "warn" : "brand",
    },
    { label: t("ordersDone"), value: summary?.done ?? "—", href: "/orders?state=done", tone: "ok" },
  ];
  const tiles = [
    { label: t("activeClients"), value: active.length, href: "/clients?status=ACTIVE" },
    { label: t("prospects"), value: prospects.length, href: "/clients?status=PROSPECT" },
    { label: t("totalLimits"), value: formatNumber(limits), href: "/clients" },
    { label: t("catalogItems"), value: variants.length, href: "/products" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${t("welcome")} ${me?.name ?? ""}`} />

      <div className="grid grid-cols-3 gap-3">
        {orderTiles.map((tile) => (
          <Link key={tile.label} href={tile.href}>
            <Card
              className={clsx(
                "h-full transition hover:ring-2 hover:ring-brand-100",
                tile.tone === "warn" && "bg-warn-bg",
                tile.tone === "ok" && "bg-ok-bg",
              )}
            >
              <div className="text-xs text-muted">{tile.label}</div>
              <div className="mt-1 text-3xl font-bold">{tile.value}</div>
            </Card>
          </Link>
        ))}
      </div>

      {summary && (
        <Card className="flex flex-col gap-2">
          <h2 className="font-bold">{t("needsUpdate")}</h2>
          <p className="text-xs text-muted">{t("needsUpdateHint", { n: summary.staleDays })}</p>
          {!summary.stale.length && <p className="text-sm text-ok">✓ {t("allUpToDate")}</p>}
          <ul className="divide-y divide-line">
            {summary.stale.map((o) => (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-brand-50">
                  <span className="flex min-w-0 items-center gap-2">
                    <bdi className="font-semibold">{o.number}</bdi>
                    <StatusBadge status={o.status} />
                    <span className="truncate text-sm text-muted">{o.client.name}</span>
                  </span>
                  <span className="text-xs font-semibold text-warn">
                    {t("lastUpdate")}: {t("daysAgo", { n: daysSince(o.lastActivityAt) })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {summary && summary.chequesToUpdate.length > 0 && (
        <Card className="flex flex-col gap-2 bg-warn-bg">
          <h2 className="font-bold">{t("chequesToUpdate")}</h2>
          <p className="text-xs text-muted">{t("chequesToUpdateHint")}</p>
          <ul className="divide-y divide-line">
            {summary.chequesToUpdate.map((c) => (
              <li key={c.id}>
                <Link href={`/clients/${c.clientId}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-sm">
                    <bdi className="font-semibold">{formatNumber(c.amount)}</bdi> · {t(`method.${c.method}`)} ({t(`purpose.${c.purpose}`)}) ·{" "}
                    {c.clientName}
                  </span>
                  <span className="text-xs font-semibold text-warn">
                    <bdi>{c.dueDate}</bdi>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Link key={tile.label} href={tile.href}>
            <Card className="h-full transition hover:ring-2 hover:ring-brand-100">
              <div className="text-xs text-muted">{tile.label}</div>
              <div className="mt-1 text-2xl font-bold">{tile.value}</div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
