"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { ClientAccountPanel } from "@/components/client-account";
import { ClientForm } from "@/components/client-form";
import { PhoneIcon } from "@/components/icons";
import { Badge, Button, Card, Muted, PageHeader } from "@/components/ui";
import { formatNumber } from "@/lib/api";
import { useClient } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";

export default function ClientPage() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const { data: client, isLoading, error } = useClient(id);
  const [editing, setEditing] = useState(false);

  if (isLoading) return <Muted>{t("loading")}</Muted>;
  if (error || !client) return <Muted>{t("error")}</Muted>;

  if (editing)
    return (
      <>
        <PageHeader title={client.name} actions={<Button variant="secondary" onClick={() => setEditing(false)}>{t("cancel")}</Button>} />
        <ClientForm client={client} onSaved={() => setEditing(false)} />
      </>
    );

  const terms = client.paymentTermsDays ? `${client.paymentTermsDays} ${t("days")}` : t("cash");
  const rows: [string, string | null][] = [
    [t("code"), client.code],
    [t("city"), client.city],
    [t("address"), client.address],
    [t("crNumber"), client.crNumber],
    [t("vatNumber"), client.vatNumber],
    [t("rep"), client.rep?.name ?? null],
  ];

  return (
    <>
      <PageHeader
        title={client.name}
        subtitle={[client.code, client.city].filter(Boolean).join(" · ")}
        actions={<Button variant="secondary" onClick={() => setEditing(true)}>{t("edit")}</Button>}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-bold">{t("creditTerms")}</h2>
            <Badge tone={client.status === "ACTIVE" ? "ok" : client.status === "PROSPECT" ? "info" : "neutral"}>
              {t(`status.${client.status}`)}
            </Badge>
          </div>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted">{t("creditLimit")}</dt>
              <dd className="text-lg font-bold">{formatNumber(client.creditLimit)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t("openingBalance")}</dt>
              <dd className="text-lg font-bold">{formatNumber(client.openingBalance)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t("paymentTerms")}</dt>
              <dd className="text-lg font-bold">{terms}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <h2 className="mb-2 font-bold">{t("purchasing")}</h2>
          {client.purchasingName || client.purchasingPhone || client.purchasingEmail ? (
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">
                <div className="font-semibold">{client.purchasingName}</div>
                <div className="text-muted" dir="ltr">{client.purchasingPhone}</div>
                <div className="text-muted" dir="ltr">{client.purchasingEmail}</div>
              </div>
              {client.purchasingPhone && (
                <a
                  href={`tel:+${client.purchasingPhone}`}
                  aria-label={t("phone")}
                  className="flex h-11 w-11 items-center justify-center rounded-xl border border-line text-brand-700"
                >
                  <PhoneIcon width={20} height={20} />
                </a>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">—</p>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd>{value || "—"}</dd>
              </div>
            ))}
          </dl>
          {client.notes && <p className="mt-3 whitespace-pre-line border-t border-line pt-3 text-sm">{client.notes}</p>}
        </Card>
      </div>
      <ClientAccountPanel client={client} />
    </>
  );
}
