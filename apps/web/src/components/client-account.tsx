"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useAccount, useOrders, usePayments, useProjects } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { fileUrl, formatMoney, today, uploadFile } from "@/lib/orders";
import type { Client, ClientProject, Payment, PaymentMethod } from "@/lib/types";
import { ProjectForm, ReasonAction, Stat, StatusBadge } from "./order-bits";
import { Badge, Button, Card, Input, Notice, Select } from "./ui";

function AccountCard({ clientId }: { clientId: string }) {
  const { t } = useI18n();
  const { data: a } = useAccount(clientId);
  if (!a) return null;
  const used = a.creditLimit > 0 ? Math.min(100, Math.max(0, Math.round((a.balance / a.creditLimit) * 100))) : 0;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">{t("account")}</h2>
        <Link href={`/clients/${clientId}/statement`}>
          <Button variant="secondary" className="min-h-9">{t("statement")}</Button>
        </Link>
      </div>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("ordersTotal")}>{formatMoney(a.ordersTotal)}</Stat>
        <Stat label={t("paid")}>{formatMoney(a.paid)}</Stat>
        <Stat label={t("balance")}>{formatMoney(a.balance)}</Stat>
        <Stat label={t("available")} strong>
          <span className={a.available < 0 ? "text-danger" : undefined}>{formatMoney(a.available)}</span>
        </Stat>
      </dl>
      {(a.pending > 0 || a.guarantees > 0 || a.approvedCredit > 0) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          {a.pending > 0 && <span>{t("pendingCollection")}: <bdi className="font-semibold text-ink">{formatMoney(a.pending)}</bdi></span>}
          {a.guarantees > 0 && <span>{t("guaranteesHeld")}: <bdi className="font-semibold text-ink">{formatMoney(a.guarantees)}</bdi></span>}
          {a.approvedCredit > 0 && <span>{t("approvedCredit")}: <bdi className="font-semibold text-ok">+{formatMoney(a.approvedCredit)}</bdi></span>}
        </div>
      )}
      {a.creditLimit > 0 && (
        <div className="h-2.5 overflow-hidden rounded-full bg-canvas" aria-label={`${used}%`}>
          <div
            className={clsx("h-full rounded-full", used >= 90 ? "bg-danger" : used >= 75 ? "bg-warn" : "bg-brand-700")}
            style={{ width: `${used}%` }}
          />
        </div>
      )}
    </Card>
  );
}

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

/** Keeps numbers and dates in their own direction inside Arabic text. */
const isolate = (s: string) => `\u2068${s}\u2069`;

function ApprovalForm({ clientId, p, refresh, onDone }: { clientId: string; p: Payment; refresh: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [amount, setAmount] = useState(String(p.creditApprovedAmount ?? Math.round(p.amount * 0.9 * 100) / 100));
  const [approvedBy, setApprovedBy] = useState(p.approvedBy ?? "");
  const [file, setFile] = useState<File | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const fileId = file ? (await uploadFile(file)).id : undefined;
      return api(`/clients/${clientId}/payments/${p.id}/approval`, {
        method: "PUT",
        body: { amount: Number(amount), approvedBy, fileId },
      });
    },
    onSuccess: () => (refresh(), onDone()),
  });
  return (
    <div role="group" className="grid grid-cols-2 gap-2 rounded-xl bg-canvas p-3">
      <Input label={t("approvedAmount")} hint="90%" value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="any" min={0} max={p.amount} dir="ltr" />
      <Input label={t("approvedBy")} value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} />
      <label className="col-span-2 flex flex-col gap-1 text-xs text-muted">
        {t("approvalProof")}
        <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm text-ink" />
      </label>
      {save.error && <div className="col-span-2"><Notice>{save.error.message}</Notice></div>}
      <div className="col-span-2 flex gap-2">
        <Button type="button" onClick={() => save.mutate()} disabled={save.isPending || !approvedBy.trim()}>{t("save")}</Button>
        <Button type="button" variant="secondary" onClick={onDone}>{t("cancel")}</Button>
      </div>
    </div>
  );
}

function PaymentRow({ clientId, p, refresh }: { clientId: string; p: Payment; refresh: () => void }) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const guarantee = p.purpose === "GUARANTEE";
  const setStatus = (status: "RECEIVED" | "BOUNCED" | "RETURNED", reason?: string) =>
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
          {guarantee && <> ({t("purpose.GUARANTEE")})</>} · <bdi>{p.date}</bdi>
          {p.bank && <> · {p.bank}</>}
          {p.reference && <> · <bdi>{p.reference}</bdi></>}
          {p.file && <> · <a href={fileUrl(p.file.id)} target="_blank" rel="noreferrer" className="text-brand-700 underline">{t("receipt")}</a></>}
        </div>
        <Badge tone={p.status === "RECEIVED" ? "ok" : p.status === "PENDING" ? "warn" : "danger"}>
          {guarantee && p.status === "PENDING" ? t("held") : t(`payStatus.${p.status}`)}
        </Badge>
      </div>
      {(p.dueDate || p.collectedDate) && (
        <div className="text-xs text-muted">
          {p.dueDate && <>{guarantee ? t("chequeDate") : t("chequeDueDate")}: <bdi>{p.dueDate}</bdi></>}
          {p.dueDate && p.collectedDate && " · "}
          {p.collectedDate && p.method !== "TRANSFER" && p.method !== "CASH" && t("collectedOn", { date: p.collectedDate })}
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
      {approving && <ApprovalForm clientId={clientId} p={p} refresh={refresh} onDone={() => setApproving(false)} />}
      {p.removedAt ? (
        <Badge tone="danger">{t("removed")}: {p.removedReason}</Badge>
      ) : (
        <div className="flex flex-wrap gap-2">
          {p.status === "PENDING" && (
            <>
              <Button variant="secondary" className="min-h-9" onClick={() => setStatus("RECEIVED")}>
                ✓ {guarantee ? t("markCashed") : t("markCollected")}
              </Button>
              {guarantee && <ReasonAction label={t("markReturned")} variant="secondary" onConfirm={(reason) => setStatus("RETURNED", reason)} />}
              <ReasonAction label={t("markBounced")} onConfirm={(reason) => setStatus("BOUNCED", reason)} />
              {!approving && (
                <Button variant="ghost" className="min-h-9" onClick={() => setApproving(true)}>
                  {p.creditApprovedAmount !== null ? t("editApproval") : t("creditApproval")}
                </Button>
              )}
              {p.creditApprovedAmount !== null && (
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
  const [purpose, setPurpose] = useState<"PAYMENT" | "GUARANTEE">("PAYMENT");
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
          purpose: deferred ? purpose : "PAYMENT",
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
            <Select label={t("purpose")} value={purpose} onChange={(e) => setPurpose(e.target.value as "PAYMENT" | "GUARANTEE")}>
              <option value="PAYMENT">{t("purpose.PAYMENT")}</option>
              <option value="GUARANTEE">{t("purpose.GUARANTEE")}</option>
            </Select>
          )}
          {deferred && (
            <Input
              label={purpose === "GUARANTEE" && method === "CHEQUE" ? t("chequeDate") : t("chequeDueDate")}
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
          {deferred && <p className="col-span-2 text-xs text-muted">{purpose === "GUARANTEE" ? t("guaranteeHint") : t("pendingNotCounted")}</p>}
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

/** Everything about the client's business with us: account, projects, payments, orders. */
export function ClientAccountPanel({ client }: { client: Client }) {
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div className="lg:col-span-2"><AccountCard clientId={client.id} /></div>
      <div className="lg:col-span-2"><ClientOrders client={client} /></div>
      <Projects clientId={client.id} />
      <Payments clientId={client.id} />
    </div>
  );
}
