"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useAcceptedPrices, useOrders, usePayments, useProjects, useQuotations, useVariants } from "@/lib/hooks";
import { quoteTone } from "@/lib/quotation";
import { useI18n } from "@/lib/i18n";
import { fileUrl, formatMoney, today, uploadFile } from "@/lib/orders";
import type { Client, ClientProject, Payment, PaymentMethod } from "@/lib/types";
import { ApprovalForm, CreditPanel, isolate } from "./credit-panel";
import { Guarantees } from "./guarantees";
import { ProjectForm, ReasonAction, StatusBadge } from "./order-bits";
import { Badge, Button, Card, Input, Notice, Select } from "./ui";

function ProjectItem({ clientId, project }: { clientId: string; project: ClientProject }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  if (editing) return <ProjectForm clientId={clientId} project={project} onDone={() => setEditing(false)} />;
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-line p-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{project.name}</div>
        {project.contacts && <p className="whitespace-pre-line text-muted">{project.contacts}</p>}
      </div>
      <div className="flex gap-1">
        {project.mapsUrl && (
          <a href={project.mapsUrl} target="_blank" rel="noreferrer">
            <Button variant="secondary" className="min-h-9">{t("openMap")}</Button>
          </a>
        )}
        <Button variant="ghost" className="min-h-9" onClick={() => setEditing(true)}>{t("edit")}</Button>
      </div>
    </li>
  );
}

function Projects({ clientId }: { clientId: string }) {
  const { t } = useI18n();
  const { data: projects = [] } = useProjects(clientId);
  const [adding, setAdding] = useState(false);
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">{t("projects")}</h2>
        <Button variant="secondary" className="min-h-9" onClick={() => setAdding((v) => !v)}>+ {t("newProject")}</Button>
      </div>
      {adding && <ProjectForm clientId={clientId} onDone={() => setAdding(false)} />}
      {!projects.length && !adding && <p className="text-sm text-muted">—</p>}
      <ul className="flex flex-col gap-2">
        {projects.map((p) => <ProjectItem key={p.id} clientId={clientId} project={p} />)}
      </ul>
    </Card>
  );
}

const METHODS = ["TRANSFER", "CASH", "CHEQUE", "LC"] as const;


function PaymentRow({ clientId, p, refresh }: { clientId: string; p: Payment; refresh: () => void }) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const setStatus = (status: "RECEIVED" | "BOUNCED", reason?: string) =>
    api(`/clients/${clientId}/payments/${p.id}/status`, { method: "PUT", body: { status, reason, collectedDate: today() } })
      .then(refresh)
      .catch((e: Error) => setError(e.message));
  const off = Boolean(p.removedAt) || p.status === "BOUNCED" || p.status === "RETURNED";
  const withdraw = () =>
    api(`/clients/${clientId}/payments/${p.id}/approval`, { method: "PUT", body: { amount: 0 } })
      .then(refresh)
      .catch((e: Error) => setError(e.message));
  return (
    <li className={clsx("flex flex-col gap-2 rounded-xl border border-line p-3 text-sm", off && "opacity-60")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={clsx(off && "line-through")}>
          <bdi className="font-bold">{formatMoney(p.amount)}</bdi> · {t(`method.${p.method}`)}
 · <bdi>{p.date}</bdi>
          {p.bank && <> · {p.bank}</>}
          {p.reference && <> · <bdi>{p.reference}</bdi></>}
          {p.file && <> · <a href={fileUrl(p.file.id)} target="_blank" rel="noreferrer" className="text-brand-700 underline">{t("receipt")}</a></>}
        </div>
        <Badge tone={p.status === "RECEIVED" ? "ok" : p.status === "PENDING" ? "warn" : "danger"}>
          {t(`payStatus.${p.status}`)}
        </Badge>
      </div>
      {(p.dueDate || p.collectedDate) && (
        <div className="text-xs text-muted">
          {p.dueDate && <>{t("chequeDueDate")}: <bdi>{p.dueDate}</bdi></>}
          {p.dueDate && p.collectedDate && " · "}
          {p.collectedDate && p.method !== "TRANSFER" && p.method !== "CASH" && t("collectedOn", { date: p.collectedDate })}
        </div>
      )}
      {p.method === "LC" && p.status === "PENDING" && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone="ok">{`${t("addsCredit")} +${isolate(formatMoney(p.amount))}`}</Badge>
          <span className="text-muted">{t("lcCounts")}</span>
          {p.lcAttention && <Badge tone="warn">{t("lcAttention")}</Badge>}
        </div>
      )}
      {p.creditApprovedAmount !== null && p.approvalUntil && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone={p.approvalValid ? "ok" : "neutral"}>
            {p.approvalValid
              ? t("approvalBadge", { amount: isolate(formatMoney(p.creditApprovedAmount)), date: isolate(p.approvalUntil) })
              : t("approvalExpired", { date: isolate(p.approvalUntil) })}
          </Badge>
          <span className="text-muted">
            {t("approvedBy")}: {p.approvedBy} · <bdi>{p.approvedAt}</bdi>
          </span>
          {p.approvalFile && (
            <a href={fileUrl(p.approvalFile.id)} target="_blank" rel="noreferrer" className="text-brand-700 underline">{t("approvalProof")}</a>
          )}
        </div>
      )}
      {p.notes && <p className="whitespace-pre-line text-xs text-muted">{p.notes}</p>}
      {approving && (
        <ApprovalForm
          url={`/clients/${clientId}/payments/${p.id}/approval`}
          amount={p.amount}
          current={p.creditApprovedAmount}
          approvedBy={p.approvedBy}
          onSaved={() => (refresh(), setApproving(false))}
          onCancel={() => setApproving(false)}
        />
      )}
      {p.removedAt ? (
        <Badge tone="danger">{t("removed")}: {p.removedReason}</Badge>
      ) : (
        <div className="flex flex-wrap gap-2">
          {p.status === "PENDING" && (
            <>
              <Button variant="secondary" className="min-h-9" onClick={() => setStatus("RECEIVED")}>
                ✓ {t("markCollected")}
              </Button>
              <ReasonAction label={t("markBounced")} onConfirm={(reason) => setStatus("BOUNCED", reason)} />
              {p.method === "CHEQUE" && !approving && (
                <Button variant="ghost" className="min-h-9" onClick={() => setApproving(true)}>
                  {p.creditApprovedAmount !== null ? t("editApproval") : t("creditApproval")}
                </Button>
              )}
              {p.method === "CHEQUE" && p.creditApprovedAmount !== null && (
                <Button variant="ghost" className="min-h-9" onClick={withdraw}>{t("withdrawApproval")}</Button>
              )}
            </>
          )}
          <ReasonAction
            label={t("remove")}
            onConfirm={(reason) => api(`/clients/${clientId}/payments/${p.id}`, { method: "DELETE", body: { reason } }).then(refresh)}
          />
        </div>
      )}
      {error && <Notice>{error}</Notice>}
    </li>
  );
}

function Payments({ clientId }: { clientId: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data: payments = [] } = usePayments(clientId);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState<PaymentMethod>("TRANSFER");
  const [dueDate, setDueDate] = useState("");
  const [bank, setBank] = useState("");
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const deferred = method === "CHEQUE" || method === "LC";
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["payments", clientId] });
    qc.invalidateQueries({ queryKey: ["account", clientId] });
    qc.invalidateQueries({ queryKey: ["statement", clientId] });
  };
  const add = useMutation({
    mutationFn: async () => {
      const fileId = file ? (await uploadFile(file)).id : null;
      return api(`/clients/${clientId}/payments`, {
        method: "POST",
        body: {
          amount: Number(amount),
          date,
          method,
          reference: reference || null,
          fileId,
          dueDate: deferred ? dueDate : null,
          bank: bank || null,
        },
      });
    },
    onSuccess: () => {
      setAmount("");
      setReference("");
      setDueDate("");
      setFile(null);
      refresh();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate(undefined, { onSuccess: () => (e.target as HTMLFormElement).reset() });
  };
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-bold">{t("payments")}</h2>
      {!payments.length && <p className="text-sm text-muted">—</p>}
      <ul className="flex flex-col gap-2">
        {payments.map((p) => <PaymentRow key={p.id} clientId={clientId} p={p} refresh={refresh} />)}
      </ul>
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-brand-700">+ {t("addPayment")}</summary>
        <form onSubmit={submit} className="mt-3 grid grid-cols-2 gap-2">
          <Select label={t("type")} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {METHODS.map((m) => <option key={m} value={m}>{t(`method.${m}`)}</option>)}
          </Select>
          <Input label={t("amount")} value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="any" min={0.01} required dir="ltr" />
          <Input label={deferred ? t("receivedDate") : t("transferDate")} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          {deferred && (
            <Input
              label={t("chequeDueDate")}
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              required
            />
          )}
          <Input label={t("bank")} hint={t("optional")} value={bank} onChange={(e) => setBank(e.target.value)} />
          <Input label={t("reference")} hint={t("optional")} value={reference} onChange={(e) => setReference(e.target.value)} dir="ltr" />
          <label className="col-span-2 flex flex-col gap-1 text-xs text-muted">
            {t("receipt")}
            <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm text-ink" />
          </label>
          {deferred && <p className="col-span-2 text-xs text-muted">{method === "LC" ? t("lcCounts") : t("pendingNotCounted")}</p>}
          {add.error && <div className="col-span-2"><Notice>{add.error.message}</Notice></div>}
          <div className="col-span-2"><Button type="submit" disabled={add.isPending}>{t("save")}</Button></div>
        </form>
      </details>
    </Card>
  );
}

function ClientOrders({ client }: { client: Client }) {
  const { t } = useI18n();
  const { data: orders = [] } = useOrders({ clientId: client.id });
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">{t("clientOrders")}</h2>
        {client.status === "ACTIVE" && (
          <Link href={`/orders/new?clientId=${client.id}`}>
            <Button className="min-h-9">+ {t("newOrder")}</Button>
          </Link>
        )}
      </div>
      {!orders.length && <p className="text-sm text-muted">{t("noOrders")}</p>}
      <ul className="divide-y divide-line">
        {orders.map((o) => (
          <li key={o.id}>
            <Link href={`/orders/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-brand-50">
              <span className="flex items-center gap-2">
                <bdi className="font-semibold">{o.number}</bdi>
                <StatusBadge status={o.status} />
              </span>
              <span className="text-sm text-muted">
                {o.project?.name && `${o.project.name} · `}
                <bdi>{o.orderDate}</bdi> · <bdi className={clsx("font-semibold text-ink", o.status === "CANCELLED" && "line-through")}>{formatMoney(o.totals.total)}</bdi>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ClientQuotations({ client }: { client: Client }) {
  const { t } = useI18n();
  const { data: list = [] } = useQuotations({ clientId: client.id });
  const { data: prices = [] } = useAcceptedPrices(client.id);
  const { data: variants = [] } = useVariants();
  const names = new Map(variants.map((v) => [v.id, [v.product.name, v.brand?.name].filter(Boolean).join(" — ")]));
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">{t("clientQuotations")}</h2>
        <Link href={`/quotations/new?clientId=${client.id}`}>
          <Button className="min-h-9">+ {t("newQuotation")}</Button>
        </Link>
      </div>
      {!list.length && <p className="text-sm text-muted">{t("noQuotations")}</p>}
      <ul className="divide-y divide-line">
        {list.map((q) => (
          <li key={q.id}>
            <Link href={`/quotations/${q.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-brand-50">
              <span className="flex min-w-0 items-center gap-2">
                <bdi className="font-semibold">{q.number}</bdi>
                <Badge tone={quoteTone(q.status)}>{t(`qStatus.${q.status}`)}</Badge>
                <span className="truncate text-sm text-muted">{q.items.join("، ")}</span>
              </span>
              <span className="text-sm text-muted">
                <bdi>{q.date}</bdi> · <bdi className="font-semibold text-ink">{formatMoney(q.totals.total)}</bdi>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {prices.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-line pt-3">
          <h3 className="text-sm font-bold">{t("acceptedPrices")}</h3>
          <ul className="divide-y divide-line text-sm">
            {prices.map((p) => (
              <li key={p.variantId} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span>{names.get(p.variantId) ?? p.name}</span>
                <span className="text-xs text-muted">
                  <bdi className="text-sm font-bold text-ink">{formatMoney(p.unitPrice)}</bdi> / {t(`unit.${p.unit}`)} ·{" "}
                  <Link href={`/quotations/${p.quotationId}`} className="underline"><bdi>{p.number}</bdi></Link> · <bdi>{p.acceptedAt}</bdi>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/** Everything about the client's business with us: account, projects, payments, orders. */
export function ClientAccountPanel({ client }: { client: Client }) {
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div className="lg:col-span-2"><CreditPanel clientId={client.id} /></div>
      <div className="lg:col-span-2"><ClientOrders client={client} /></div>
      <div className="lg:col-span-2"><ClientQuotations client={client} /></div>
      <Payments clientId={client.id} />
      <Guarantees clientId={client.id} />
      <Projects clientId={client.id} />
    </div>
  );
}
