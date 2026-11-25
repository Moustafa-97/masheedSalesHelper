"use client";

import clsx from "clsx";
import Link from "next/link";
import { UsageBar } from "@/components/credit-panel";
import { StatusBadge } from "@/components/order-bits";
import { Badge, Card, PageHeader } from "@/components/ui";
import { formatNumber } from "@/lib/api";
import { useClients, useMe, useOrdersSummary, useVariants } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { formatMoney } from "@/lib/orders";
import type { GuaranteeType, PaymentMethod } from "@/lib/types";

const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

function Tile({ label, value, href, tone }: { label: string; value: string | number; href: string; tone?: "warn" | "ok" | "danger" }) {
  return (
    <Link href={href}>
      <Card
        className={clsx(
          "h-full transition hover:ring-2 hover:ring-brand-100",
          tone === "warn" && "bg-warn-bg",
          tone === "ok" && "bg-ok-bg",
          tone === "danger" && "bg-danger-bg",
        )}
      >
        <div className="text-xs text-muted">{label}</div>
        <div className="mt-1 text-2xl font-bold sm:text-3xl"><bdi>{value}</bdi></div>
      </Card>
    </Link>
  );
}

export default function HomePage() {
  const { t } = useI18n();
  const { data: me } = useMe();
  const { data: clients = [] } = useClients();
  const { data: variants = [] } = useVariants();
  const { data: s } = useOrdersSummary();

  const active = clients.filter((c) => c.status === "ACTIVE");
  const prospects = clients.filter((c) => c.status === "PROSPECT");
  const limits = active.reduce((sum, c) => sum + c.creditLimit, 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${t("welcome")} ${me?.name ?? ""}`} />

      <div className="grid grid-cols-3 gap-3">
        <Tile label={t("ordersOpen")} value={s?.open ?? "—"} href="/orders?state=open" />
        <Tile label={t("needsUpdate")} value={s?.staleCount ?? "—"} href="/orders?state=open" tone={s?.staleCount ? "warn" : undefined} />
        <Tile label={t("ordersDone")} value={s?.done ?? "—"} href="/orders?state=done" tone="ok" />
      </div>

      {s && (
        <div className="grid grid-cols-2 gap-3">
          <Tile label={t("receivables")} value={formatMoney(s.receivables.balance)} href="/clients?status=ACTIVE" />
          <Tile
            label={t("overdueTotal")}
            value={formatMoney(s.receivables.overdue)}
            href="/clients?status=ACTIVE"
            tone={s.receivables.overdue > 0 ? "danger" : "ok"}
          />
        </div>
      )}

      {s && s.followUps.length > 0 && (
        <Card className="flex flex-col gap-2 bg-warn-bg">
          <h2 className="font-bold">{t("followUps")}</h2>
          <ul className="divide-y divide-line">
            {s.followUps.map((f) => (
              <li key={f.id}>
                <Link href={`/clients/${f.clientId}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-sm">
                    <Badge tone={f.kind === "AWAITING_REPLACEMENT" ? "danger" : "warn"}>{t(`fu.${f.kind}`)}</Badge>{" "}
                    {f.amount !== null && <bdi className="font-semibold">{formatNumber(f.amount)}</bdi>} ·{" "}
                    {f.source === "GUARANTEE" ? t(`gType.${f.type as GuaranteeType}`) : t(`method.${f.type as PaymentMethod}`)} · {f.clientName}
                  </span>
                  {f.date && <bdi className="text-xs font-semibold text-warn">{f.date}</bdi>}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {s && (
        <Card className="flex flex-col gap-2">
          <h2 className="font-bold">{t("needsUpdate")}</h2>
          <p className="text-xs text-muted">{t("needsUpdateHint", { n: s.staleDays })}</p>
          {!s.stale.length && <p className="text-sm text-ok">✓ {t("allUpToDate")}</p>}
          <ul className="divide-y divide-line">
            {s.stale.map((o) => (
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

      {s && (s.overdueClients.length > 0 || s.nearLimit.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {s.overdueClients.length > 0 && (
            <Card className="flex flex-col gap-2">
              <h2 className="font-bold">{t("overdueClients")}</h2>
              <ul className="divide-y divide-line">
                {s.overdueClients.map((c) => (
                  <li key={c.clientId}>
                    <Link href={`/clients/${c.clientId}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-brand-50">
                      <span className="flex items-center gap-2 text-sm">
                        <span className="font-semibold">{c.clientName}</span>
                        {c.overdueStop && <Badge tone="danger">{t("stopped")}</Badge>}
                      </span>
                      <span className="text-sm">
                        <bdi className="font-semibold text-danger">{formatMoney(c.overdue)}</bdi>{" "}
                        <span className="text-xs text-muted">{t("daysLate", { n: c.maxDaysOverdue })}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {s.nearLimit.length > 0 && (
            <Card className="flex flex-col gap-2">
              <h2 className="font-bold">{t("nearLimit")}</h2>
              <ul className="flex flex-col gap-3">
                {s.nearLimit.map((c) => (
                  <li key={c.clientId}>
                    <Link href={`/clients/${c.clientId}`} className="flex flex-col gap-1">
                      <span className="flex justify-between text-sm">
                        <span className="font-semibold">{c.clientName}</span>
                        <span className="text-xs text-muted">{t("available")} <bdi>{formatMoney(c.available)}</bdi></span>
                      </span>
                      <UsageBar pct={c.usagePct} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label={t("activeClients")} value={active.length} href="/clients?status=ACTIVE" />
        <Tile label={t("prospects")} value={prospects.length} href="/clients?status=PROSPECT" />
        <Tile label={t("totalLimits")} value={formatNumber(limits)} href="/clients" />
        <Tile label={t("catalogItems")} value={variants.length} href="/products" />
      </div>
    </div>
  );
}
