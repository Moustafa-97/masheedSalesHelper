"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { isolate } from "@/components/credit-panel";
import { Stat } from "@/components/order-bits";
import { CompetitorInput, TermsSelect, useTerms } from "@/components/market-bits";
import { Badge, Button, Card, Input, Muted, Notice, PageHeader, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useQuotation } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { formatMoney, formatQty, today } from "@/lib/orders";
import { defaultPdfName, quoteTone } from "@/lib/quotation";
import { LOST_REASONS } from "@/lib/market";
import type { LostReason, Quotation, QuotationStatus } from "@/lib/types";

function LostForm({
  q,
  onSubmit,
  onCancel,
}: {
  q: Quotation;
  onSubmit: (body: { status: "LOST" } & Record<string, unknown>) => Promise<unknown>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [lostAt, setLostAt] = useState(today());
  const [reason, setReason] = useState<LostReason | "">("");
  const [note, setNote] = useState("");
  const [competitor, setCompetitor] = useState("");
  const [theirTerms, setTheirTerms] = useState(q.creditDays);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      status: "LOST" as const,
      lostAt,
      lostReasonCode: reason,
      lostReason: note || undefined,
      competitor: competitor || undefined,
      competitorCreditDays: theirTerms,
      linePrices: Object.entries(prices)
        .filter(([, v]) => v.trim() !== "")
        .map(([lineId, v]) => ({ lineId, price: Number(v) })),
    }).catch((err: Error) => setError(err.message));
  };
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl bg-danger-bg p-3 md:grid-cols-3">
      <Select label={t("reason")} value={reason} onChange={(e) => setReason(e.target.value as LostReason)} required>
        <option value="">—</option>
        {LOST_REASONS.map((r) => <option key={r} value={r}>{t(`lostReason.${r}`)}</option>)}
      </Select>
      <Input label={t("note")} hint={reason === "OTHER" ? undefined : t("optional")} value={note} onChange={(e) => setNote(e.target.value)} required={reason === "OTHER"} className="md:col-span-2" />
      <CompetitorInput label={t("competitor")} value={competitor} onChange={setCompetitor} />
      <TermsSelect label={t("theirTerms")} value={theirTerms} onChange={setTheirTerms} />
      <Input label={t("date")} type="date" value={lostAt} onChange={(e) => setLostAt(e.target.value)} required />
      <div className="flex flex-col gap-2 md:col-span-3">
        <p className="text-xs text-muted">{t("theirPricesHint")}</p>
        {q.lines.map((l) => (
          <div key={l.id} className="grid grid-cols-[1fr_9rem] items-end gap-2">
            <div className="text-sm">
              <div className="font-semibold">{l.name}</div>
              <div className="text-xs text-muted">{t("ourPrice")}: <bdi>{formatMoney(l.unitPrice)}</bdi></div>
            </div>
            <Input
              label={t("competitorPrice")}
              value={prices[l.id] ?? ""}
              onChange={(e) => setPrices((p) => ({ ...p, [l.id]: e.target.value }))}
              type="number"
              step="any"
              min={0}
              dir="ltr"
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2 md:col-span-3">
        <Button type="submit" variant="danger">{t("confirm")}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>{t("cancel")}</Button>
      </div>
      {error && <div className="md:col-span-3"><Notice>{error}</Notice></div>}
    </form>
  );
}

function History({ q }: { q: Quotation }) {
  const { t } = useI18n();
  const terms = useTerms();
  if (!q.history.length) return null;
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="font-bold">{t("history")}</h2>
      <ol className="flex flex-col gap-2 text-sm">
        {q.history.map((e) => (
          <li key={e.id} className="border-s-2 border-line ps-3">
            <div className="flex flex-wrap gap-x-2">
              <span className="font-semibold">{t(`qEvent.${e.type}` as "qEvent.CREATED")}</span>
              <span className="text-xs text-muted"><bdi>{new Date(e.at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</bdi> · {e.by}</span>
            </div>
            {e.type === "LOST" && (
              <div className="text-xs text-muted">
                {e.data.reason && t(`lostReason.${e.data.reason}`)}
                {e.data.note && ` — ${e.data.note}`}
                {e.data.competitor && ` · ${e.data.competitor}`}
                {e.data.competitorCreditDays !== undefined && ` (${terms(e.data.competitorCreditDays)})`}
                {e.data.prices?.map((p) => (
                  <div key={p.name}>
                    {p.name}: {t("ourPrice")} <bdi>{formatMoney(p.ours)}</bdi> · {t("competitorPrice")} <bdi>{formatMoney(p.theirs)}</bdi>
                  </div>
                ))}
              </div>
            )}
            {e.type === "ACCEPTED" && e.data.acceptedAt && <div className="text-xs text-muted"><bdi>{e.data.acceptedAt}</bdi></div>}
          </li>
        ))}
      </ol>
    </Card>
  );
}

export default function QuotationPage() {
  const { t } = useI18n();
  const terms = useTerms();
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
      qc.invalidateQueries({ queryKey: ["market-prices"] });
      qc.invalidateQueries({ queryKey: ["lost-deals"] });
      qc.invalidateQueries({ queryKey: ["market-analysis"] });
      qc.invalidateQueries({ queryKey: ["competitors"] });
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
            {t("lostBecause", { reason: [q.lostReasonCode && t(`lostReason.${q.lostReasonCode}`), q.lostReason].filter(Boolean).join(" — ") })}
            {q.lostAt && <> · <bdi>{q.lostAt}</bdi></>}
            {q.competitor && ` · ${t("competitor")}: ${q.competitor.name}`}
            {q.competitorCreditDays !== null && ` (${terms(q.competitorCreditDays)})`}
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
        {losing && <LostForm q={q} onSubmit={setStatus} onCancel={() => setLosing(false)} />}
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
        <Stat label={t("paymentTerms")}>{terms(q.creditDays)}</Stat>
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
              {l.competitorPrice !== null && (
                <p className="text-xs text-danger">{t("competitorPrice")}: <bdi>{formatMoney(l.competitorPrice)}</bdi></p>
              )}
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

      <History q={q} />
    </div>
  );
}
