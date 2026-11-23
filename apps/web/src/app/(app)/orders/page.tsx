"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { StatusBadge } from "@/components/order-bits";
import { Button, Card, Input, Muted, PageHeader, Select } from "@/components/ui";
import { ordersQuery, useClients, useOrders, type OrderFilters } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { formatMoney, ORDER_FLOW } from "@/lib/orders";

function OrdersList() {
  const { t } = useI18n();
  const params = useSearchParams();
  const [filters, setFilters] = useState<OrderFilters>({
    clientId: params.get("clientId") ?? undefined,
    status: params.get("status") ?? undefined,
  });
  const set = (k: keyof OrderFilters, v: string) => setFilters((f) => ({ ...f, [k]: v || undefined }));
  const { data: orders = [], isLoading } = useOrders(filters);
  const { data: clients = [] } = useClients();

  return (
    <>
      <PageHeader
        title={t("orders")}
        subtitle={orders.length ? `${orders.length}` : undefined}
        actions={
          <>
            <a href={`/api/orders/export${ordersQuery(filters)}`} download>
              <Button variant="secondary">{t("exportExcel")}</Button>
            </a>
            <Link href={`/orders/new${filters.clientId ? `?clientId=${filters.clientId}` : ""}`}>
              <Button>{t("newOrder")}</Button>
            </Link>
          </>
        }
      />

      <Card className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Input
          label={t("search")}
          value={filters.q ?? ""}
          onChange={(e) => set("q", e.target.value)}
          type="search"
          className="col-span-2 lg:col-span-1"
        />
        <Select label={t("client")} value={filters.clientId ?? ""} onChange={(e) => set("clientId", e.target.value)}>
          <option value="">{t("all")}</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select label={t("status")} value={filters.status ?? ""} onChange={(e) => set("status", e.target.value)}>
          <option value="">{t("allStatuses")}</option>
          {[...ORDER_FLOW, "CANCELLED" as const].map((s) => (
            <option key={s} value={s}>{t(`orderStatus.${s}`)}</option>
          ))}
        </Select>
        <Input label={t("from")} type="date" value={filters.from ?? ""} onChange={(e) => set("from", e.target.value)} />
        <Input label={t("to")} type="date" value={filters.to ?? ""} onChange={(e) => set("to", e.target.value)} />
      </Card>

      {isLoading && <Muted>{t("loading")}</Muted>}
      {!isLoading && !orders.length && <Muted>{t("noOrders")}</Muted>}
      <ul className="flex flex-col gap-2">
        {orders.map((o) => (
          <li key={o.id}>
            <Link href={`/orders/${o.id}`}>
              <Card className={`flex flex-wrap items-center gap-x-4 gap-y-2 transition hover:ring-2 hover:ring-brand-100 ${o.status === "CANCELLED" ? "opacity-60" : ""}`}>
                <div className="min-w-0 flex-[1_1_220px]">
                  <div className="flex items-center gap-2">
                    <span className="font-bold" dir="ltr">{o.number}</span>
                    <StatusBadge status={o.status} />
                  </div>
                  <div className="truncate text-sm text-muted">
                    {o.client.name}
                    {o.project && ` · ${o.project.name}`}
                  </div>
                </div>
                <div className="flex flex-[1_1_200px] items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-canvas" aria-label={t("deliveredPct", { n: o.deliveredPct })}>
                    <div className="h-full rounded-full bg-brand-700" style={{ width: `${o.deliveredPct}%` }} />
                  </div>
                  <span className="w-12 text-xs text-muted">{o.deliveredPct}%</span>
                </div>
                <div className="text-end text-sm">
                  <div className={`font-bold ${o.status === "CANCELLED" ? "line-through" : ""}`} dir="ltr">
                    {formatMoney(o.totals.total)}
                  </div>
                  <div className="text-xs text-muted">
                    <bdi>{o.orderDate}</bdi> · {t("dueDate")} <bdi>{o.dueDate}</bdi>
                  </div>
                </div>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function OrdersPage() {
  return (
    <Suspense>
      <OrdersList />
    </Suspense>
  );
}
