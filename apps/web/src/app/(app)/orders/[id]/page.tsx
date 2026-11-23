"use client";

import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { ItemPicker, ReasonAction, Stat, StatusBadge } from "@/components/order-bits";
import { Badge, Button, Card, Input, Muted, Notice, PageHeader, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useMe, useOrder, useProjects, useVariants } from "@/lib/hooks";
import { useI18n, type MessageKey } from "@/lib/i18n";
import {
  DOCUMENT_TYPES,
  fileUrl,
  formatMoney,
  formatQty,
  ORDER_FLOW,
  supplyMessage,
  today,
  uploadFile,
  whatsappLink,
} from "@/lib/orders";
import type { DocumentType, OrderDetail, OrderLine } from "@/lib/types";

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

/** Runs an order action and puts the returned order straight into the cache. */
function useOrderAction(id: string) {
  const qc = useQueryClient();
  return async (path: string, method: "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown) => {
    const order = await api<OrderDetail>(`/orders/${id}${path}`, { method, body });
    qc.setQueryData(["orders", id], order);
    qc.invalidateQueries({ queryKey: ["orders"], exact: false, refetchType: "none" });
    qc.invalidateQueries({ queryKey: ["account", order.clientId] });
    return order;
  };
}

function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">{title}</h2>
        {actions}
      </div>
      {children}
    </Card>
  );
}

/* ---------- Header actions: WhatsApp, copy, share ---------- */

function SupplyActions({ order, act }: { order: OrderDetail; act: ReturnType<typeof useOrderAction> }) {
  const { t } = useI18n();
  const { data: me } = useMe();
  const [copied, setCopied] = useState(false);
  const message = supplyMessage(order);
  const pos = order.documents.filter((d) => !d.removedAt && d.type === "PO");
  const canShare = typeof navigator !== "undefined" && "canShare" in navigator;

  const markSent = () => {
    if (order.status === "NEW") act("/status", "PUT", { status: "SENT_TO_SUPPLY" }).catch(() => undefined);
  };
  const copy = async () => {
    await navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const share = async () => {
    const files = await Promise.all(
      pos.map(async (d) => {
        const blob = await fetch(fileUrl(d.file.id)).then((r) => r.blob());
        return new File([blob], d.file.originalName, { type: d.file.mimeType });
      }),
    );
    const data = { files, text: message };
    if (navigator.canShare?.(data)) await navigator.share(data).catch(() => undefined);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <a href={whatsappLink(message, me)} target="_blank" rel="noreferrer" onClick={markSent}>
          <Button variant="accent">{t("sendToSupply")}</Button>
        </a>
        <Button variant="secondary" onClick={copy}>{copied ? t("copied") : t("copyMessage")}</Button>
        {canShare && pos.length > 0 && (
          <Button variant="secondary" onClick={share}>{t("shareFiles")} ({pos.length})</Button>
        )}
      </div>
      {!me?.supplyContactPhone && <p className="text-xs text-muted">{t("noSupplyContact")}</p>}
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted">{t("copyMessage")}</summary>
        <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-canvas p-3 font-sans text-sm">{message}</pre>
      </details>
    </div>
  );
}

/* ---------- Status ---------- */

function StatusSteps({ order, act, editable }: { order: OrderDetail; act: ReturnType<typeof useOrderAction>; editable: boolean }) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const current = ORDER_FLOW.indexOf(order.status);
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-wrap gap-1.5">
        {ORDER_FLOW.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              disabled={!editable || s === order.status}
              onClick={() => {
                setError(null);
                act("/status", "PUT", { status: s }).catch((e: Error) => setError(e.message));
              }}
              className={clsx(
                "min-h-9 rounded-full border px-3 text-xs font-semibold",
                i < current && "border-brand-700 bg-brand-50 text-brand-800",
                i === current && "border-brand-700 bg-brand-700 text-white",
                i > current && "border-line text-muted hover:bg-brand-50",
              )}
            >
              {i < current ? "✓ " : ""}
              {t(`orderStatus.${s}`)}
            </button>
          </li>
        ))}
      </ol>
      {error && <Notice>{error}</Notice>}
    </div>
  );
}

function Checklist({ order }: { order: OrderDetail }) {
  const { t } = useI18n();
  const items = (["fullyDelivered", "hasDeliveryNote", "hasPurchaseInvoice", "hasSalesInvoice"] as const).map((k) => ({
    k,
    ok: order.checklist[k],
  }));
  return (
    <ul className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
      {items.map(({ k, ok }) => (
        <li key={k} className={clsx("rounded-xl px-3 py-2", ok ? "bg-ok-bg text-ok" : "bg-canvas text-muted")}>
          {ok ? "✓" : "○"} {t(`check.${k}`)}
        </li>
      ))}
    </ul>
  );
}

/* ---------- Lines ---------- */

function LineRow({ line, act, editable }: { line: OrderLine; act: ReturnType<typeof useOrderAction>; editable: boolean }) {
  const { t } = useI18n();
  const unit = t(`unit.${line.unit}`);
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(String(line.qty));
  const [price, setPrice] = useState(String(line.unitPrice));
  const [cost, setCost] = useState(line.purchasePrice === null ? "" : String(line.purchasePrice));
  const [reason, setReason] = useState(line.belowMinReason ?? "");
  const [error, setError] = useState<string | null>(null);
  const removed = Boolean(line.removedAt);
  const pct = line.qty ? Math.min(100, Math.round((line.delivered / line.qty) * 100)) : 0;
  const below = line.minQty !== null && num(qty) < line.minQty;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await act(`/lines/${line.id}`, "PATCH", {
        qty: num(qty),
        unitPrice: num(price),
        purchasePrice: cost.trim() === "" ? null : num(cost),
        ...(below && { belowMinReason: reason }),
      });
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <li className={clsx("flex flex-col gap-2 px-4 py-3", removed && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={clsx("font-semibold", removed && "line-through")}>{line.description}</div>
          <div className="flex flex-wrap gap-2 text-xs text-muted">
            {line.color && <span>{t("color")}: {line.color}</span>}
            {line.belowMinReason && <span>{t("belowMin", { min: formatQty(line.minQty) })}: {line.belowMinReason}</span>}
            {removed && <Badge tone="danger">{t("removed")}: {line.removedReason}</Badge>}
          </div>
        </div>
        <div className="text-end text-sm">
          <bdi className={clsx("font-bold", removed && "line-through")}>{formatMoney(line.qty * line.unitPrice)}</bdi>
          <div className="text-xs text-muted">
            <bdi>{formatQty(line.qty)} {unit} × {formatMoney(line.unitPrice)}</bdi>
            {line.purchasePrice !== null && <> · {t("purchasePrice")} <bdi>{formatMoney(line.purchasePrice)}</bdi></>}
          </div>
        </div>
      </div>

      {!removed && (
        <div className="flex items-center gap-3">
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-canvas">
            <div className={clsx("h-full rounded-full", pct >= 100 ? "bg-ok" : "bg-brand-700")} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs font-semibold">
            {pct >= 100 ? `✓ ${t("fullyReceived")}` : t("receivedOf", { d: formatQty(line.delivered), q: `${formatQty(line.qty)} ${unit}` })}
          </span>
        </div>
      )}

      {editable && !removed && !editing && (
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" className="min-h-9" onClick={() => setEditing(true)}>{t("edit")}</Button>
          <ReasonAction label={t("removeLine")} onConfirm={(r) => act(`/lines/${line.id}`, "DELETE", { reason: r })} />
        </div>
      )}
      {editing && (
        <form onSubmit={save} className="flex flex-col gap-2 rounded-xl bg-canvas p-3">
          <div className="grid grid-cols-3 gap-2">
            <Input label={`${t("qty")} (${unit})`} value={qty} onChange={(e) => setQty(e.target.value)} type="number" step="any" min={0.001} required dir="ltr" />
            <Input label={t("unitPrice")} value={price} onChange={(e) => setPrice(e.target.value)} type="number" step="any" min={0} required dir="ltr" />
            <Input label={t("purchasePrice")} value={cost} onChange={(e) => setCost(e.target.value)} type="number" step="any" min={0} dir="ltr" />
          </div>
          {below && <Input label={t("belowMinReason")} value={reason} onChange={(e) => setReason(e.target.value)} required />}
          {error && <Notice>{error}</Notice>}
          <div className="flex gap-2">
            <Button type="submit">{t("save")}</Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>{t("cancel")}</Button>
          </div>
        </form>
      )}
    </li>
  );
}

function AddLine({ act }: { act: ReturnType<typeof useOrderAction> }) {
  const { t } = useI18n();
  const { data: variants = [] } = useVariants();
  const [variantId, setVariantId] = useState("");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const variant = variants.find((v) => v.id === variantId);
  const below = variant?.minQty !== null && variant !== undefined && num(qty) < (variant.minQty ?? 0);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await act("/lines", "POST", {
        variantId,
        qty: num(qty),
        unitPrice: num(price),
        purchasePrice: cost === "" ? null : num(cost),
        belowMinReason: below ? reason : null,
      });
      setVariantId("");
      setQty("");
      setPrice("");
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <details className="px-4 pb-3">
      <summary className="cursor-pointer text-sm font-semibold text-brand-700">+ {t("addLine")}</summary>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-2">
        <ItemPicker variants={variants} value={variantId} onChange={setVariantId} required />
        <div className="grid grid-cols-3 gap-2">
          <Input label={t("qty")} value={qty} onChange={(e) => setQty(e.target.value)} type="number" step="any" min={0.001} required dir="ltr" />
          <Input label={t("unitPrice")} hint={t("exclVat")} value={price} onChange={(e) => setPrice(e.target.value)} type="number" step="any" min={0} required dir="ltr" />
          <Input label={t("purchasePrice")} value={cost} onChange={(e) => setCost(e.target.value)} type="number" step="any" min={0} dir="ltr" />
        </div>
        {below && <Input label={t("belowMinReason")} value={reason} onChange={(e) => setReason(e.target.value)} required />}
        {error && <Notice>{error}</Notice>}
        <div><Button type="submit" disabled={!variantId}>{t("add")}</Button></div>
      </form>
    </details>
  );
}

function OnePurchasePrice({ act }: { act: ReturnType<typeof useOrderAction> }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        act("/purchase-price", "PUT", { purchasePrice: num(value) })
          .then(() => setValue(""))
          .catch((err: Error) => setError(err.message));
      }}
    >
      <Input label={t("onePurchasePrice")} value={value} onChange={(e) => setValue(e.target.value)} type="number" step="any" min={0} required dir="ltr" className="w-48" />
      <Button type="submit" variant="secondary">{t("applyAll")}</Button>
      {error && <Notice>{error}</Notice>}
    </form>
  );
}

/* ---------- Deliveries ---------- */

function AddDelivery({ order, act }: { order: OrderDetail; act: ReturnType<typeof useOrderAction> }) {
  const { t } = useI18n();
  const open = order.lines.filter((l) => !l.removedAt && l.remaining > 0);
  const [date, setDate] = useState(today());
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open.length) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const lines = open.filter((l) => num(qtys[l.id] ?? "") > 0).map((l) => ({ orderLineId: l.id, qty: num(qtys[l.id]) }));
    if (!lines.length) return setError(t("enterReceived"));
    setBusy(true);
    try {
      let documentId: string | null = null;
      if (file) {
        const stored = await uploadFile(file);
        const withDoc = await act("/documents", "POST", { fileId: stored.id, type: "DELIVERY_NOTE", reference: reference || null });
        documentId = withDoc.documents.filter((d) => d.file.id === stored.id)[0]?.id ?? null;
      }
      await act("/deliveries", "POST", { date, reference: reference || null, documentId, notes: notes || null, lines });
      setQtys({});
      setReference("");
      setFile(null);
      setNotes("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-brand-700">+ {t("addDelivery")}</summary>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          <Input label={t("deliveryDate")} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          <Input label={t("deliveryNoteNo")} value={reference} onChange={(e) => setReference(e.target.value)} dir="ltr" />
          <label className="col-span-2 flex flex-col gap-1 text-xs text-muted md:col-span-1">
            {t("deliveryNoteFile")}
            <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm text-ink" />
          </label>
        </div>
        <ul className="flex flex-col gap-2">
          {open.map((l) => (
            <li key={l.id} className="flex flex-wrap items-end gap-2 rounded-xl bg-canvas p-2">
              <div className="min-w-0 flex-[1_1_200px] text-sm">
                <div className="font-semibold">{l.description}</div>
                <div className="text-xs text-muted">
                  {t("remaining")}: <bdi>{formatQty(l.remaining)} {t(`unit.${l.unit}`)}</bdi>
                </div>
              </div>
              <Input
                label={t("receivedNow")}
                value={qtys[l.id] ?? ""}
                onChange={(e) => setQtys((q) => ({ ...q, [l.id]: e.target.value }))}
                type="number"
                step="any"
                min={0}
                max={l.remaining}
                dir="ltr"
                className="w-36"
              />
              <Button type="button" variant="ghost" className="min-h-11" onClick={() => setQtys((q) => ({ ...q, [l.id]: String(l.remaining) }))}>
                {t("all")}
              </Button>
            </li>
          ))}
        </ul>
        <Textarea label={t("notes")} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        {error && <Notice>{error}</Notice>}
        <div><Button type="submit" disabled={busy}>{t("save")}</Button></div>
      </form>
    </details>
  );
}

/* ---------- Documents and invoices ---------- */

function UploadDocument({ act }: { act: ReturnType<typeof useOrderAction> }) {
  const { t } = useI18n();
  const [type, setType] = useState<DocumentType>("PO");
  const [reference, setReference] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Several files at once (e.g. a steel order with more than one PO)
      for (const f of files) {
        const stored = await uploadFile(f);
        await act("/documents", "POST", { fileId: stored.id, type, reference: reference || null });
      }
      setFiles([]);
      setReference("");
      (e.target as HTMLFormElement).reset();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-brand-700">+ {t("uploadDocument")}</summary>
      <form onSubmit={submit} className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Select label={t("type")} value={type} onChange={(e) => setType(e.target.value as DocumentType)}>
          {DOCUMENT_TYPES.map((d) => <option key={d} value={d}>{t(`docType.${d}`)}</option>)}
        </Select>
        <Input label={t("reference")} hint={t("optional")} value={reference} onChange={(e) => setReference(e.target.value)} dir="ltr" />
        <label className="col-span-2 flex flex-col gap-1 text-xs text-muted">
          {t("file")}
          <input type="file" multiple required accept="application/pdf,image/*,.xlsx,.xls,.docx,.doc" onChange={(e) => setFiles([...(e.target.files ?? [])])} className="text-sm text-ink" />
        </label>
        {type === "PURCHASE_INVOICE" && <p className="col-span-2 text-xs text-muted md:col-span-4">{t("internalOnly")}</p>}
        {error && <div className="col-span-2 md:col-span-4"><Notice>{error}</Notice></div>}
        <div className="col-span-2 md:col-span-4"><Button type="submit" disabled={busy || !files.length}>{t("save")}</Button></div>
      </form>
    </details>
  );
}

function AddInvoice({ order, act }: { order: OrderDetail; act: ReturnType<typeof useOrderAction> }) {
  const { t } = useI18n();
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState(String(order.totals.total));
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      let documentId: string | null = null;
      if (file) {
        const stored = await uploadFile(file);
        const withDoc = await act("/documents", "POST", { fileId: stored.id, type: "SALES_INVOICE", reference: number });
        documentId = withDoc.documents.find((d) => d.file.id === stored.id)?.id ?? null;
      }
      await act("/invoices", "POST", { number, date, amount: num(amount), documentId });
      setNumber("");
      setFile(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-brand-700">+ {t("addInvoice")}</summary>
      <form onSubmit={submit} className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Input label={t("invoiceNumber")} value={number} onChange={(e) => setNumber(e.target.value)} required dir="ltr" />
        <Input label={t("invoiceDate")} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <Input label={`${t("amount")} (${t("inclVat")})`} value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="any" min={0} required dir="ltr" />
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t("file")}
          <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm text-ink" />
        </label>
        {error && <div className="col-span-2 md:col-span-4"><Notice>{error}</Notice></div>}
        <div className="col-span-2 md:col-span-4"><Button type="submit" disabled={busy}>{t("save")}</Button></div>
      </form>
    </details>
  );
}

/* ---------- Order details edit ---------- */

function EditDetails({ order, act, onDone }: { order: OrderDetail; act: ReturnType<typeof useOrderAction>; onDone: () => void }) {
  const { t } = useI18n();
  const { data: projects = [] } = useProjects(order.clientId);
  const [number, setNumber] = useState(order.number);
  const [orderDate, setOrderDate] = useState(order.orderDate);
  const [projectId, setProjectId] = useState(order.projectId ?? "");
  const [notes, setNotes] = useState(order.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-2 md:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        act("", "PATCH", { number, orderDate, projectId: projectId || null, notes: notes || null })
          .then(onDone)
          .catch((err: Error) => setError(err.message));
      }}
    >
      <Input label={t("orderNumber")} value={number} onChange={(e) => setNumber(e.target.value)} required dir="ltr" />
      <Input label={t("orderDate")} type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} required />
      <Select label={t("project")} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
        <option value="">{t("noProject")}</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>
      <Textarea label={t("notes")} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="md:col-span-3" />
      {error && <div className="md:col-span-3"><Notice>{error}</Notice></div>}
      <div className="flex gap-2 md:col-span-3">
        <Button type="submit">{t("save")}</Button>
        <Button type="button" variant="secondary" onClick={onDone}>{t("cancel")}</Button>
      </div>
    </form>
  );
}

/* ---------- History ---------- */

function describe(type: string, data: Record<string, unknown>, t: (k: MessageKey, v?: Record<string, string | number>) => string) {
  const statusName = (s: unknown) => t(`orderStatus.${s as OrderDetail["status"]}`);
  switch (type) {
    case "STATUS":
      return `${t("from")} ${statusName(data.from)} ${t("to")} ${statusName(data.to)}${data.auto ? ` (${t("autoStatus")})` : ""}`;
    case "LINE_CHANGED": {
      const changes = Object.entries((data.changes ?? {}) as Record<string, [unknown, unknown]>)
        .map(([k, [a, b]]) => `${t(`field.${k}` as MessageKey)} ${t("from")} ${a ?? "—"} ${t("to")} ${b ?? "—"}`)
        .join("، ");
      return `${data.description}: ${changes}`;
    }
    case "UPDATED":
      return Object.entries(data as Record<string, [unknown, unknown]>)
        .map(([k, [a, b]]) => (k === "projectId" ? t("field.projectId") : `${t(`field.${k}` as MessageKey)} ${t("from")} ${a ?? "—"} ${t("to")} ${b ?? "—"}`))
        .join("، ");
    case "LINE_ADDED":
    case "LINE_REMOVED":
      return `${data.description} (${formatQty(data.qty as number)})${data.reason ? ` — ${data.reason}` : ""}`;
    case "DELIVERY_ADDED":
      return ((data.lines ?? []) as { description: string; qty: number }[]).map((l) => `${formatQty(l.qty)} ${l.description}`).join("، ");
    case "DOCUMENT_ADDED":
    case "DOCUMENT_REMOVED":
      return `${t(`docType.${data.type as DocumentType}`)}${data.reference ? ` ${data.reference}` : ""}${data.reason ? ` — ${data.reason}` : ""}`;
    case "INVOICE_ADDED":
      return `${data.number} · ${formatMoney(data.amount as number)}`;
    case "PURCHASE_PRICE_SET":
      return formatMoney(data.purchasePrice as number);
    default:
      return (data.reason as string) ?? "";
  }
}

/* ---------- Page ---------- */

export default function OrderPage() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const { data: order, isLoading, error } = useOrder(id);
  const act = useOrderAction(id);
  const [editing, setEditing] = useState(false);

  if (isLoading) return <Muted>{t("loading")}</Muted>;
  if (error || !order) return <Muted>{error?.message ?? t("error")}</Muted>;

  const editable = order.status !== "CANCELLED";
  const fileOf = (documentId: string | null) => order.documents.find((d) => d.id === documentId)?.file;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={order.number}
        subtitle={`${order.client.name}${order.project ? ` · ${order.project.name}` : ""}`}
        actions={<StatusBadge status={order.status} />}
      />

      {order.status === "CANCELLED" && <Notice>{t("cancelledBecause", { reason: order.cancelReason ?? "" })}</Notice>}

      <Card className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t("client")}>
            <Link href={`/clients/${order.client.id}`} className="text-brand-700 underline">{order.client.name}</Link>
          </Stat>
          <Stat label={t("orderDate")}>{order.orderDate}</Stat>
          <Stat label={t("dueDate")}>{order.dueDate}</Stat>
          <Stat label={t("total")} strong>{formatMoney(order.totals.total)}</Stat>
        </dl>
        {order.project && (
          <div className="flex flex-wrap items-start gap-3 rounded-xl bg-canvas p-3 text-sm">
            <div className="flex-1">
              <div className="font-semibold">{order.project.name}</div>
              {order.project.contacts && <p className="whitespace-pre-line text-muted">{order.project.contacts}</p>}
            </div>
            {order.project.mapsUrl && (
              <a href={order.project.mapsUrl} target="_blank" rel="noreferrer">
                <Button variant="secondary">{t("openMap")}</Button>
              </a>
            )}
          </div>
        )}
        {order.notes && <p className="whitespace-pre-line text-sm">{order.notes}</p>}
        {editable && <SupplyActions order={order} act={act} />}
        {editable && !editing && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            <Button variant="secondary" onClick={() => setEditing(true)}>{t("editOrder")}</Button>
            <ReasonAction label={t("cancelOrder")} variant="secondary" onConfirm={(reason) => act("/cancel", "POST", { reason })} />
          </div>
        )}
        {editing && <EditDetails order={order} act={act} onDone={() => setEditing(false)} />}
      </Card>

      <Section title={t("status")}>
        <StatusSteps order={order} act={act} editable={editable} />
        <h3 className="text-xs font-semibold text-muted">{t("checklist")}</h3>
        <Checklist order={order} />
      </Section>

      <Card className="flex flex-col p-0">
        <h2 className="px-4 pt-4 font-bold">{t("lines")}</h2>
        <ul className="divide-y divide-line">
          {order.lines.map((l) => (
            <LineRow key={`${l.id}-${l.qty}-${l.unitPrice}-${l.purchasePrice}-${l.removedAt}`} line={l} act={act} editable={editable} />
          ))}
        </ul>
        {editable && <AddLine act={act} />}
        <div className="flex flex-col gap-3 border-t border-line p-4">
          <dl className="grid grid-cols-3 gap-3">
            <Stat label={t("subtotal")}>{formatMoney(order.totals.subtotal)}</Stat>
            <Stat label={t("vat", { rate: order.vatRate })}>{formatMoney(order.totals.vat)}</Stat>
            <Stat label={t("total")} strong>{formatMoney(order.totals.total)}</Stat>
          </dl>
          <p className="text-sm">
            {t("margin")}:{" "}
            {order.margin ? (
              <bdi className="font-bold">
                {formatMoney(order.margin.amount)} ({order.totals.subtotal ? Math.round((order.margin.amount / order.totals.subtotal) * 1000) / 10 : 0}%)
              </bdi>
            ) : (
              <span className="text-muted">{t("marginHint")}</span>
            )}
          </p>
          {editable && <OnePurchasePrice act={act} />}
        </div>
      </Card>

      <Section title={t("deliveries")}>
        {!order.deliveries.length && <p className="text-sm text-muted">—</p>}
        <ul className="flex flex-col gap-2">
          {order.deliveries.map((d) => {
            const file = fileOf(d.documentId);
            return (
              <li key={d.id} className={clsx("flex flex-col gap-1 rounded-xl border border-line p-3 text-sm", d.removedAt && "opacity-60")}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={clsx("font-semibold", d.removedAt && "line-through")}>
                    <bdi>{d.date}</bdi>{d.reference && <> · <bdi>{d.reference}</bdi></>}
                  </span>
                  {file && <a href={fileUrl(file.id)} target="_blank" rel="noreferrer" className="text-brand-700 underline">{t("downloadFile")}</a>}
                </div>
                <ul className={clsx("text-muted", d.removedAt && "line-through")}>
                  {d.lines.map((dl) => {
                    const line = order.lines.find((l) => l.id === dl.orderLineId);
                    return <li key={dl.id}><bdi>{formatQty(dl.qty)} {line ? t(`unit.${line.unit}`) : ""}</bdi> · {line?.description}</li>;
                  })}
                </ul>
                {d.notes && <p className="text-xs text-muted">{d.notes}</p>}
                {d.removedAt ? (
                  <Badge tone="danger">{t("removed")}: {d.removedReason}</Badge>
                ) : (
                  editable && <ReasonAction label={t("remove")} onConfirm={(reason) => act(`/deliveries/${d.id}`, "DELETE", { reason })} className="self-start" />
                )}
              </li>
            );
          })}
        </ul>
        {editable && <AddDelivery order={order} act={act} />}
      </Section>

      <Section title={t("documents")}>
        {!order.documents.length && <p className="text-sm text-muted">—</p>}
        <ul className="flex flex-col gap-2">
          {order.documents.map((d) => (
            <li key={d.id} className={clsx("flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3 text-sm", d.removedAt && "opacity-60")}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge tone={d.type === "PURCHASE_INVOICE" ? "warn" : "info"}>{t(`docType.${d.type}`)}</Badge>
                  {d.reference && <bdi className="font-semibold">{d.reference}</bdi>}
                </div>
                <a href={fileUrl(d.file.id)} target="_blank" rel="noreferrer" className={clsx("block truncate text-brand-700 underline", d.removedAt && "line-through")}>
                  {d.file.originalName}
                </a>
                {d.removedAt && <Badge tone="danger">{t("removed")}: {d.removedReason}</Badge>}
              </div>
              {editable && !d.removedAt && (
                <ReasonAction label={t("remove")} onConfirm={(reason) => act(`/documents/${d.id}`, "DELETE", { reason })} />
              )}
            </li>
          ))}
        </ul>
        {editable && <UploadDocument act={act} />}
      </Section>

      <Section title={t("invoices")}>
        {!order.invoices.length && <p className="text-sm text-muted">—</p>}
        <ul className="flex flex-col gap-2">
          {order.invoices.map((inv) => {
            const file = fileOf(inv.documentId);
            return (
              <li key={inv.id} className={clsx("flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3 text-sm", inv.removedAt && "opacity-60")}>
                <div className={clsx(inv.removedAt && "line-through")}>
                  <bdi className="font-semibold">{inv.number}</bdi> · <bdi>{inv.date}</bdi> · <bdi>{formatMoney(inv.amount)}</bdi>
                  {file && <> · <a href={fileUrl(file.id)} target="_blank" rel="noreferrer" className="text-brand-700 underline">{t("downloadFile")}</a></>}
                </div>
                {inv.removedAt ? (
                  <Badge tone="danger">{t("removed")}: {inv.removedReason}</Badge>
                ) : (
                  editable && <ReasonAction label={t("remove")} onConfirm={(reason) => act(`/invoices/${inv.id}`, "DELETE", { reason })} />
                )}
              </li>
            );
          })}
        </ul>
        {editable && <AddInvoice order={order} act={act} />}
      </Section>

      <Section title={t("history")}>
        <ol className="flex flex-col gap-2 text-sm">
          {order.events.map((e) => (
            <li key={e.id} className="border-s-2 border-line ps-3">
              <div>
                <span className="font-semibold">{e.user.name}</span> {t(`event.${e.type}` as MessageKey)}
              </div>
              <div className="text-xs text-muted">{describe(e.type, e.data, t)}</div>
              <time className="text-[11px] text-muted" dateTime={e.createdAt}>
                {new Date(e.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
              </time>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
