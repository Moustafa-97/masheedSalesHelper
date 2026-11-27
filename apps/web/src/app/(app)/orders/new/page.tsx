"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { ItemPicker, ProjectForm, Stat } from "@/components/order-bits";
import { Button, Card, Input, Notice, PageHeader, Select, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useAcceptedPrices, useAccount, useClients, useProjects, useVariants } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { formatMoney, formatQty, today } from "@/lib/orders";
import type { OrderDetail, Variant } from "@/lib/types";

const VAT = 15;
const round2 = (n: number) => Math.round(n * 100) / 100;

interface DraftLine {
  key: number;
  variant: Variant;
  qty: string;
  unitPrice: string;
  purchasePrice: string;
  color: string;
  belowMinReason: string;
}

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
const belowMin = (l: DraftLine) => l.variant.minQty !== null && num(l.qty) < l.variant.minQty;

function NewOrderForm() {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const { data: clients = [] } = useClients({ status: "ACTIVE" });
  const { data: variants = [] } = useVariants();

  const [clientId, setClientId] = useState(params.get("clientId") ?? "");
  const [projectId, setProjectId] = useState("");
  const [addingProject, setAddingProject] = useState(false);
  const [number, setNumber] = useState("");
  const [orderDate, setOrderDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [pick, setPick] = useState("");
  const [allCost, setAllCost] = useState("");
  const [allPrice, setAllPrice] = useState("");
  const [bypassBy, setBypassBy] = useState("");
  const [bypassReason, setBypassReason] = useState("");
  const { data: projects = [] } = useProjects(clientId || undefined);
  const { data: account } = useAccount(clientId || undefined);
  const { data: accepted = [] } = useAcceptedPrices(clientId || undefined);
  const acceptedFor = (variantId: string) => accepted.find((a) => a.variantId === variantId);

  const update = (key: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const addPicked = () => {
    const variant = variants.find((v) => v.id === pick);
    if (!variant) return;
    setLines((ls) => [
      ...ls,
      {
        key: Date.now(),
        variant,
        qty: variant.minQty ? String(variant.minQty) : "",
        // The client's last accepted price for this item, unless one price was set for all lines.
        unitPrice: allPrice || (acceptedFor(variant.id) ? String(acceptedFor(variant.id)!.unitPrice) : ""),
        purchasePrice: allCost,
        color: "",
        belowMinReason: "",
      },
    ]);
    setPick("");
  };

  const subtotal = round2(lines.reduce((s, l) => s + (num(l.qty) || 0) * (num(l.unitPrice) || 0), 0));
  const vat = round2((subtotal * VAT) / 100);
  const total = round2(subtotal + vat);
  const over = account ? round2(total - account.available) : 0;

  const save = useMutation({
    mutationFn: () =>
      api<OrderDetail>("/orders", {
        method: "POST",
        body: {
          number,
          clientId,
          projectId: projectId || null,
          orderDate,
          notes: notes.trim() || null,
          overdueBypass: bypassBy.trim() && bypassReason.trim() ? { approvedBy: bypassBy, reason: bypassReason } : null,
          lines: lines.map((l) => ({
            variantId: l.variant.id,
            qty: num(l.qty),
            unitPrice: num(l.unitPrice),
            purchasePrice: l.purchasePrice.trim() === "" ? null : num(l.purchasePrice),
            color: l.color || null,
            belowMinReason: belowMin(l) ? l.belowMinReason : null,
          })),
        },
      }),
    onSuccess: (order) => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["account", clientId] });
      router.push(`/orders/${order.id}`);
    },
  });

  /** The API's English message, said in the page's language for the cases a rep meets every day. */
  const errorText = (e: Error) => {
    const err = e as ApiError;
    if (err.code === "OVERDUE") {
      return t("overdueStopped", {
        amount: `\u2068${formatMoney(Number(err.data.overdue))}\u2069`,
        n: Number(err.data.maxDaysOverdue),
        stop: Number(err.data.overdueStopDays),
      });
    }
    if (err.code === "CREDIT_LIMIT") {
      return account && account.creditLimit > 0
        ? t("overLimit", { n: `\u2068${formatMoney(Number(err.data.required) - Number(err.data.available))}\u2069` })
        : t("cashNeedsPayment");
    }
    return e.message;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <PageHeader title={t("newOrder")} />

      <Card className="grid gap-3 md:grid-cols-2">
        <Select label={t("client")} value={clientId} onChange={(e) => (setClientId(e.target.value), setProjectId(""))} required hint={t("orderOnlyActive")}>
          <option value="">{t("selectClient")}</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <div className="flex items-end gap-2">
          <Select label={t("project")} value={projectId} onChange={(e) => setProjectId(e.target.value)} className="flex-1" disabled={!clientId}>
            <option value="">{t("noProject")}</option>
            {projects.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          {clientId && (
            <Button type="button" variant="secondary" onClick={() => setAddingProject((v) => !v)}>
              + {t("newProject")}
            </Button>
          )}
        </div>
        {addingProject && clientId && (
          <div className="md:col-span-2">
            <ProjectForm clientId={clientId} onDone={(p) => (setProjectId(p.id), setAddingProject(false))} />
          </div>
        )}
        <Input label={t("orderNumber")} hint={t("orderNumberHint")} value={number} onChange={(e) => setNumber(e.target.value)} required dir="ltr" placeholder="SO/26/000000" />
        <Input label={t("orderDate")} type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} required />
        <Textarea label={t("notes")} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="md:col-span-2" />
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-bold">{t("addLine")}</h2>
        <ItemPicker variants={variants} value={pick} onChange={setPick} />
        <div>
          <Button type="button" variant="secondary" onClick={addPicked} disabled={!pick}>+ {t("addLine")}</Button>
        </div>
      </Card>

      {lines.length > 0 && (
        <Card className="flex flex-col gap-3 p-0">
          <div className="flex flex-wrap items-end gap-2 border-b border-line p-4">
            <Input label={t("oneSalePrice")} hint={t("exclVat")} value={allPrice} onChange={(e) => setAllPrice(e.target.value)} type="number" min={0} step="any" dir="ltr" className="w-48" />
            <Button type="button" variant="secondary" onClick={() => setLines((ls) => ls.map((l) => ({ ...l, unitPrice: allPrice })))} disabled={allPrice === ""}>
              {t("applyAll")}
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-2 border-b border-line p-4">
            <Input label={t("onePurchasePrice")} value={allCost} onChange={(e) => setAllCost(e.target.value)} type="number" min={0} step="any" dir="ltr" className="w-48" />
            <Button type="button" variant="secondary" onClick={() => setLines((ls) => ls.map((l) => ({ ...l, purchasePrice: allCost })))} disabled={allCost === ""}>
              {t("applyAll")}
            </Button>
          </div>
          <ul className="divide-y divide-line">
            {lines.map((l) => {
              const unit = t(`unit.${l.variant.unit}`);
              return (
                <li key={l.key} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">{l.variant.product.name}</div>
                      <div className="text-xs text-muted">{l.variant.brand?.name}</div>
                    </div>
                    <Button type="button" variant="ghost" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                      ✕
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <Input label={`${t("qty")} (${unit})`} value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} type="number" min={0.001} step="any" required dir="ltr" />
                    <Input label={`${t("unitPrice")} / ${unit}`} hint={t("exclVat")} value={l.unitPrice} onChange={(e) => update(l.key, { unitPrice: e.target.value })} type="number" min={0} step="any" required dir="ltr" />
                    <Input label={t("purchasePrice")} hint={t("optional")} value={l.purchasePrice} onChange={(e) => update(l.key, { purchasePrice: e.target.value })} type="number" min={0} step="any" dir="ltr" />
                    {l.variant.colors.length > 0 ? (
                      <Select label={t("color")} value={l.color} onChange={(e) => update(l.key, { color: e.target.value })}>
                        <option value="">—</option>
                        {l.variant.colors.map((c) => <option key={c} value={c}>{c}</option>)}
                      </Select>
                    ) : (
                      <div className="flex flex-col justify-end text-sm">
                        <span className="text-xs text-muted">{t("lineTotal")}</span>
                        <bdi className="font-semibold">{formatMoney((num(l.qty) || 0) * (num(l.unitPrice) || 0))}</bdi>
                      </div>
                    )}
                  </div>
                  {acceptedFor(l.variant.id) && (
                    <p className="text-xs text-ok">
                      {t("acceptedPriceHint", {
                        price: `\u2068${formatMoney(acceptedFor(l.variant.id)!.unitPrice)}\u2069`,
                        number: `\u2068${acceptedFor(l.variant.id)!.number}\u2069`,
                      })}
                    </p>
                  )}
                  {belowMin(l) && (
                    <div className="flex flex-col gap-1">
                      <Notice tone="warn">{t("belowMin", { min: `${formatQty(l.variant.minQty)} ${unit}` })}</Notice>
                      <Input label={t("belowMinReason")} value={l.belowMinReason} onChange={(e) => update(l.key, { belowMinReason: e.target.value })} required />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card className="flex flex-col gap-3">
        <dl className="grid grid-cols-3 gap-3">
          <Stat label={t("subtotal")}>{formatMoney(subtotal)}</Stat>
          <Stat label={t("vat", { rate: VAT })}>{formatMoney(vat)}</Stat>
          <Stat label={t("total")} strong>{formatMoney(total)}</Stat>
        </dl>
        {account && (
          <dl className="grid grid-cols-3 gap-3 border-t border-line pt-3">
            <Stat label={t("creditLimit")}>{formatMoney(account.creditLimit)}</Stat>
            <Stat label={t("balance")}>{formatMoney(account.balance)}</Stat>
            <Stat label={t("available")} strong>{formatMoney(account.available)}</Stat>
          </dl>
        )}
        {account && over > 0 && (
          <Notice tone="warn">
            {account.creditLimit > 0 ? t("overLimit", { n: formatMoney(over) }) : t("cashNeedsPayment")}
          </Notice>
        )}
        {save.error && <Notice>{errorText(save.error)}</Notice>}
        {(save.error as ApiError | null)?.code === "OVERDUE" && (
          <div role="group" className="grid gap-2 rounded-xl bg-warn-bg p-3 md:grid-cols-2">
            <p className="text-sm font-semibold md:col-span-2">{t("overdueBypass")}</p>
            <p className="text-xs text-muted md:col-span-2">{t("overdueBypassHint")}</p>
            <Input label={t("approvedBy")} value={bypassBy} onChange={(e) => setBypassBy(e.target.value)} />
            <Input label={t("reason")} value={bypassReason} onChange={(e) => setBypassReason(e.target.value)} />
          </div>
        )}
        <div>
          <Button type="submit" disabled={save.isPending || !lines.length || !clientId}>
            {t("createOrder")}
          </Button>
        </div>
      </Card>
    </form>
  );
}

export default function NewOrderPage() {
  return (
    <Suspense>
      <NewOrderForm />
    </Suspense>
  );
}
