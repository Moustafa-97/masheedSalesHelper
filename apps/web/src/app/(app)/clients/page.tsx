"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { PlusIcon } from "@/components/icons";
import { Badge, Button, Card, Muted, PageHeader } from "@/components/ui";
import { formatNumber } from "@/lib/api";
import { useClients } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import type { ClientStatus } from "@/lib/types";

const STATUS_TONE = { ACTIVE: "ok", PROSPECT: "info", INACTIVE: "neutral" } as const;

function ClientsList() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const status = (params.get("status") as ClientStatus | null) ?? undefined;
  const [q, setQ] = useState("");
  const { data: clients, isLoading, error } = useClients({ q: q.trim() || undefined, status });

  const setStatus = (s?: ClientStatus) => router.replace(s ? `/clients?status=${s}` : "/clients");

  return (
    <>
      <PageHeader
        title={t("clients")}
        actions={
          <Link href="/clients/new">
            <Button>
              <PlusIcon width={18} height={18} />
              {t("newClient")}
            </Button>
          </Link>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("search")}
          aria-label={t("search")}
          className="min-h-11 flex-1 rounded-xl border border-line bg-white px-3 outline-none focus:border-brand-700"
        />
        <div className="flex gap-1 rounded-xl bg-white p-1">
          {([undefined, "ACTIVE", "PROSPECT", "INACTIVE"] as const).map((s) => (
            <button
              key={s ?? "all"}
              onClick={() => setStatus(s)}
              className={`min-h-9 rounded-lg px-3 text-sm ${status === s ? "bg-brand-700 font-semibold text-white" : "text-muted"}`}
            >
              {s ? t(`status.${s}`) : t("all")}
            </button>
          ))}
        </div>
      </div>

      <Card className="p-0">
        {isLoading && <Muted>{t("loading")}</Muted>}
        {error && <Muted>{t("error")}</Muted>}
        {clients?.length === 0 && <Muted>{t("empty")}</Muted>}
        <ul className="divide-y divide-line">
          {clients?.map((c) => (
            <li key={c.id}>
              <Link href={`/clients/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-brand-50">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{c.name}</div>
                  <div className="text-xs text-muted">
                    {[c.code, c.city, c.rep?.name].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone={STATUS_TONE[c.status]}>{t(`status.${c.status}`)}</Badge>
                  {c.creditLimit > 0 && (
                    <span className="text-xs text-muted">
                      {t("creditLimit")}: {formatNumber(c.creditLimit)}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

export default function ClientsPage() {
  return (
    <Suspense>
      <ClientsList />
    </Suspense>
  );
}
