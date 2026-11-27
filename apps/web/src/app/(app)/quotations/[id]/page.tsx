"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { isolate } from "@/components/credit-panel";
import { Stat } from "@/components/order-bits";
import { Badge, Button, Card, Input, Muted, Notice, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useQuotation } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { formatMoney, formatQty, today } from "@/lib/orders";
import { defaultPdfName, quoteTone } from "@/lib/quotation";
import type { Quotation, QuotationStatus } from "@/lib/types";

function LostForm({ onSubmit, onCancel }: { onSubmit: (body: { status: "LOST" } & Record<string, unknown>) => Promise<unknown>; onCancel: () => void }) {
  const { t } = useI18n();
  const [lostReason, setReason] = useState("");
  const [competitor, setCompetitor] = useState("");
  const [competitorPrice, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      status: "LOST" as const,
      lostReason,
      competitor: competitor || undefined,
      competitorPrice: competitorPrice === "" ? undefined : Number(competitorPrice),
    }).catch((err: Error) => setError(err.message));
  };
  return (
    <form onSubmit={submit} className="grid gap-2 rounded-xl bg-danger-bg p-3 md:grid-cols-3">
      <Input label={t("reason")} value={lostReason} onChange={(e) => setReason(e.target.value)} required className="md:col-span-3" />
      <Input label={t("competitor")} hint={t("optional")} value={competitor} onChange={(e) => setCompetitor(e.target.value)} />
      <Input label={t("competitorPrice")} hint={t("optional")} value={competitorPrice} onChange={(e) => setPrice(e.target.value)} type="number" step="any" min={0} dir="ltr" />
      <div className="flex items-end gap-2">
        <Button type="submit" variant="danger">{t("confirm")}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>{t("cancel")}</Button>
      </div>
      {error && <div className="md:col-span-3"><Notice>{error}</Notice></div>}
    </form>
  );
}

export default function QuotationPage() {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const { data: q, isLoading } = useQuotation(id);
  const [losing, setLosing] = useState(false);
  const [acceptDate, setAcceptDate] = useState(today());
  const [error, setError] = useState<string | null>(null);

  if (isLoading || !q) return <Muted>{t("loading")}</Muted>;

  const setStatus = async (body: { status: QuotationStatus } & Record<string, unknown>) => {
    setError(null);
    try {
      const next = await api<Quotation>(`/quotations/${id}/status`, { method: "PUT", body });
      qc.setQueryData(["quotations", id], next);
      qc.invalidateQueries({ queryKey: ["quotations"] });
      qc.invalidateQueries({ queryKey: ["accepted-prices", q.clientId] });
      setLosing(false);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  };
  const duplicate = async () => {
    const copy = await api<Quotation>(`/quotations/${id}/duplicate`, { method: "POST" });
    qc.invalidateQueries({ queryKey: ["quotations"] });
    router.push(`/quotations/${copy.id}/edit`);
  };
  const activate = async () => {
    await api(`/clients/${q.clientId}`, { method: "PATCH", body: { status: "ACTIVE" } });
    qc.invalidateQueries({ queryKey: ["quotations", id] });
    qc.invalidateQueries({ queryKey: ["clients"] });
  };
  const open = q.status === "DRAFT" || q.status === "SENT";
  const pdfName = q.pdfName || defaultPdfName(q.date);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={q.number}
        subtitle={q.client.name}
        actions={<Badge tone={quoteTone(q.status)}>{t(`qStatus.${q.status}`)}</Badge>}
      />

      <Card className="flex flex-wrap gap-2">
        <a href={`/print/quotations/${q.id}`} target="_blank" rel="noreferrer">
          <Button variant="accent">{t("exportPdf")}</Button>
        </a>
        {open && (
          <Link href={`/quotations/${q.id}/edit`}>
            <Button variant="secondary">{t("edit")}</Button>
          </Link>
        )}
        <Button variant="secondary" onClick={duplicate}>{t("duplicate")}</Button>
        <p className="w-full text-xs text-muted">
          {t("printHint")} · <bdi className="font-semibold">{pdfName}.pdf</bdi>
        </p>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-bold">{t("status")}</h2>
        {q.status === "ACCEPTED" && q.acceptedAt && <Notice tone="ok">{t("acceptedOn", { date: isolate(q.acceptedAt) })}</Notice>}
        {q.status === "LOST" && (
          <Notice>
            {t("lostBecause", { reason: q.lostReason ?? "" })}
            {q.competitor && ` · ${t("competitor")}: ${q.competitor}`}
            {q.competitorPrice !== null && <> · {t("competitorPrice")}: <bdi>{formatMoney(q.competitorPrice)}</bdi></>}
          </Notice>
        )}
        <div className="flex flex-wrap items-end gap-2">
          {q.status === "DRAFT" && <Button variant="secondary" onClick={() => setStatus({ status: "SENT" }).catch(() => undefined)}>{t("markSent")}</Button>}
          {open && (
            <>
              <Input label={t("date")} type="date" value={acceptDate} onChange={(e) => setAcceptDate(e.target.value)} className="w-44" />
              <Button onClick={() => setStatus({ status: "ACCEPTED", acceptedAt: acceptDate }).catch(() => undefined)}>✓ {t("markAccepted")}</Button>
              {!losing && <Button variant="ghost" onClick={() => setLosing(true)}>{t("markLost")}</Button>}
            </>
          )}
          {!open && <Button variant="ghost" onClick={() => setStatus({ status: "SENT" }).catch(() => undefined)}>{t("reopen")}</Button>}
        </div>
        {losing && <LostForm onSubmit={setStatus} onCancel={() => setLosing(false)} />}
        {q.status === "ACCEPTED" && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            {q.client.status === "PROSPECT" && <Button variant="secondary" onClick={activate}>{t("activateClient")}</Button>}
            {q.client.status === "ACTIVE" && (
              <Link href={`/orders/new?clientId=${q.clientId}`}>
                <Button>{t("newOrder")}</Button>
              </Link>
            )}
          </div>
        )}
        {error && <Notice>{error}</Notice>}
      </Card>

      <Card className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("client")}>
          <Link href={`/clients/${q.clientId}`} className="text-brand-700 underline">{q.client.name}</Link>
        </Stat>
        <Stat label={t("date")}>{q.date}</Stat>
        <Stat label={t("attn")}>{q.attn ?? "—"}</Stat>
        <Stat label={t("clientRef")}>{q.reference ?? "—"}</Stat>
        {q.project && <Stat label={t("project")}>{q.project.name}</Stat>}
        {q.phone && <Stat label={t("phone")}>{q.phone}</Stat>}
        {q.email && <Stat label={t("email")}>{q.email}</Stat>}
      </Card>

      <Card className="flex flex-col p-0">
        <h2 className="px-4 pt-4 font-bold">{t("lines")}</h2>
        <ul className="divide-y divide-line">
          {q.lines.map((l) => (
            <li key={l.id} className="flex flex-col gap-1 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="font-semibold">{l.name}</span>
                <span className="text-sm">
                  <bdi>{formatQty(l.qty)} {t(`unit.${l.unit}`)} × {formatMoney(l.unitPrice)}</bdi> ={" "}
                  <bdi className="font-bold">{formatMoney(l.qty * l.unitPrice)}</bdi>
                </span>
              </div>
              {l.items.length > 0 && (
                <div className="flex flex-wrap gap-1 text-xs">
                  {l.items.map((i) => <span key={i.id} className="rounded-lg bg-brand-50 px-2 py-0.5 text-brand-800">{i.name}</span>)}
                </div>
              )}
            </li>
          ))}
        </ul>
        <dl className="grid grid-cols-3 gap-3 border-t border-line p-4">
          <Stat label={t("subtotal")}>{formatMoney(q.totals.subtotal)}</Stat>
          <Stat label={t("vat", { rate: q.vatRate })}>{formatMoney(q.totals.vat)}</Stat>
          <Stat label={t("total")} strong>{formatMoney(q.totals.total)}</Stat>
        </dl>
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="font-bold">{t("terms")}</h2>
        <p className="whitespace-pre-line text-sm" dir="ltr">{q.terms}</p>
        {q.notes && <p className="whitespace-pre-line border-t border-line pt-2 text-sm text-muted">{q.notes}</p>}
      </Card>
    </div>
  );
}
