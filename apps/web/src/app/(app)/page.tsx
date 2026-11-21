"use client";

import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { formatNumber } from "@/lib/api";
import { useClients, useMe, useVariants } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";

export default function HomePage() {
  const { t } = useI18n();
  const { data: me } = useMe();
  const { data: clients = [] } = useClients();
  const { data: variants = [] } = useVariants();

  const active = clients.filter((c) => c.status === "ACTIVE");
  const prospects = clients.filter((c) => c.status === "PROSPECT");
  const limits = active.reduce((sum, c) => sum + c.creditLimit, 0);

  const tiles = [
    { label: t("activeClients"), value: active.length, href: "/clients?status=ACTIVE" },
    { label: t("prospects"), value: prospects.length, href: "/clients?status=PROSPECT" },
    { label: t("totalLimits"), value: formatNumber(limits), href: "/clients" },
    { label: t("catalogItems"), value: variants.length, href: "/products" },
  ];

  return (
    <>
      <PageHeader title={`${t("welcome")} ${me?.name ?? ""}`} />
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
    </>
  );
}
