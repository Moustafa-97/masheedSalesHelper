"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useAcceptedPrices, useClients, useProjects, useVariants } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { formatMoney, today } from "@/lib/orders";
import { defaultPdfName, defaultTerms } from "@/lib/quotation";
import type { Client, Quotation, Unit } from "@/lib/types";
import { isolate } from "./credit-panel";
import { ItemPicker, Stat } from "./order-bits";
import { Button, Card, Input, Notice, Select, Textarea } from "./ui";

const UNITS: Unit[] = ["TON", "BAG", "PIECE", "M3", "KG", "METER", "GALLON", "TRAILER"];
const VAT = 15;
const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

interface Line {
  key: number;
  name: string;
  variantIds: string[];
  unit: Unit;
  qty: string;
  unitPrice: string;
}

let seq = 0;
const blank = (): Line => ({ key: ++seq, name: "", variantIds: [], unit: "TON", qty: "", unitPrice: "" });

function LineEditor({
  line,
  update,
  remove,
  clientId,
}: {
  line: Line;
  update: (patch: Partial<Line>) => void;
  remove: () => void;
  clientId: string;
}) {
  const { t } = useI18n();
  const { data: variants = [] } = useVariants();
  const { data: accepted = [] } = useAcceptedPrices(clientId || undefined);
  const [linking, setLinking] = useState(line.variantIds.length === 0);
  const [pick, setPick] = useState("");
  const byId = new Map(variants.map((v) => [v.id, v]));
  const lastPrice = line.variantIds.map((id) => accepted.find((a) => a.variantId === id)).find(Boolean);

  const link = () => {
    const v = byId.get(pick);
    if (!v || line.variantIds.includes(v.id)) return;
    const first = line.variantIds.length === 0;
    update({
      variantIds: [...line.variantIds, v.id],
      ...(first && !line.name && { name: [v.product.name, v.brand?.name].filter(Boolean).join(" — ") }),
      ...(first && { unit: v.unit }),
    });
    setPick("");
    setLinking(false);
  };

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-[2fr_1fr_1fr_1fr_auto]">
        <Input label={t("lineName")} placeholder={t("lineNameHint")} value={line.name} onChange={(e) => update({ name: e.target.value })} required className="col-span-2 md:col-span-1" />
        <Select label={t("unit")} value={line.unit} onChange={(e) => update({ unit: e.target.value as Unit })}>
          {UNITS.map((u) => <option key={u} value={u}>{t(`unit.${u}`)}</option>)}
        </Select>
        <Input label={t("qty")} value={line.qty} onChange={(e) => update({ qty: e.target.value })} type="number" step="any" min={0.001} required dir="ltr" />
        <Input label={t("unitPrice")} hint={t("exclVat")} value={line.unitPrice} onChange={(e) => update({ unitPrice: e.target.value })} type="number" step="any" min={0} required dir="ltr" />
        <div className="flex items-end">
          <Button type="button" variant="ghost" onClick={remove} aria-label={t("remove")}>✕</Button>
        </div>
      </div>
      {lastPrice && (
        <p className="text-xs text-ok">
          {t("acceptedPriceHint", { price: isolate(formatMoney(lastPrice.unitPrice)), number: isolate(lastPrice.number) })}
          {String(lastPrice.unitPrice) !== line.unitPrice && (
            <button type="button" className="ms-2 underline" onClick={() => update({ unitPrice: String(lastPrice.unitPrice) })}>
              {t("useIt")}
            </button>
          )}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span className="text-muted">{t("linkedItems")}:</span>
        {line.variantIds.map((id) => {
          const v = byId.get(id);
          return (
            <span key={id} className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-2 py-1 text-brand-800">
              {v ? [v.product.name, v.brand?.name].filter(Boolean).join(" — ") : id.slice(0, 8)}
              <button type="button" aria-label={t("remove")} onClick={() => update({ variantIds: line.variantIds.filter((x) => x !== id) })}>✕</button>
            </span>
          );
        })}
        {!linking && (
          <button type="button" className="font-semibold text-brand-700" onClick={() => setLinking(true)}>+ {t("linkItem")}</button>
        )}
      </div>
      {linking && (
        <div className="flex flex-col gap-2 rounded-xl bg-canvas p-3">
          <p className="text-xs text-muted">{t("linkedItemsHint")}</p>
          <ItemPicker variants={variants} value={pick} onChange={setPick} />
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={link} disabled={!pick}>+ {t("linkItem")}</Button>
            <Button type="button" variant="ghost" onClick={() => setLinking(false)}>{t("cancel")}</Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Quick "new client" for a quotation: registered as a new client (prospect) so it can be followed. */
function NewClient({ onCreated }: { onCreated: (c: Client) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [phone, setPhone] = useState("");
  const save = useMutation({
    mutationFn: () =>
      api<Client>("/clients", {
        method: "POST",
        body: { name, status: "PROSPECT", purchasingName: contact || undefined, purchasingPhone: phone || undefined },
      }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      onCreated(c);
    },
  });
  return (
    <div role="group" className="grid gap-2 rounded-xl border border-line p-3 md:grid-cols-3">
      <Input label={t("clientName")} value={name} onChange={(e) => setName(e.target.value)} />
      <Input label={t("attn")} value={contact} onChange={(e) => setContact(e.target.value)} />
      <Input label={t("phone")} value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" inputMode="tel" />
      {save.error && <div className="md:col-span-3"><Notice>{save.error.message}</Notice></div>}
      <div className="md:col-span-3">
        <Button type="button" onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>{t("save")}</Button>
      </div>
    </div>
  );
}

export function QuotationForm({ initial, presetClientId }: { initial?: Quotation; presetClientId?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: clients = [] } = useClients();
  const [clientId, setClientId] = useState(initial?.clientId ?? presetClientId ?? "");
  const [addingClient, setAddingClient] = useState(false);
  const { data: projects = [] } = useProjects(clientId || undefined);
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const [date, setDate] = useState(initial?.date ?? today());
  const [attn, setAttn] = useState(initial?.attn ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [reference, setReference] = useState(initial?.reference ?? "");
  const [terms, setTerms] = useState(initial?.terms ?? "");
  const [termsTouched, setTermsTouched] = useState(!!initial);
  const [pdfName, setPdfName] = useState(initial?.pdfName ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [allPrice, setAllPrice] = useState("");
  const [lines, setLines] = useState<Line[]>(
    initial?.lines.map((l) => ({ key: ++seq, name: l.name, variantIds: l.variantIds, unit: l.unit, qty: String(l.qty), unitPrice: String(l.unitPrice) })) ?? [blank()],
  );

  /** Choosing a client fills the contact and the payment term (credit or cash) unless already typed. */
  const chooseClient = (c: Client | undefined) => {
    setClientId(c?.id ?? "");
    setProjectId("");
    if (!c) return;
    if (!attn) setAttn(c.purchasingName ?? "");
    if (!phone) setPhone(c.purchasingPhone ?? "");
    if (!email) setEmail(c.purchasingEmail ?? "");
    if (!termsTouched) setTerms(defaultTerms({ credit: c.creditLimit > 0 }));
  };

  const subtotal = round2(lines.reduce((s, l) => s + (num(l.qty) || 0) * (num(l.unitPrice) || 0), 0));
  const vat = round2((subtotal * VAT) / 100);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...(initial ? {} : { clientId }),
        projectId: projectId || null,
        date,
        attn: attn || null,
        phone: phone || null,
        email: email || null,
        reference: reference || null,
        terms: terms || defaultTerms({ credit: true }),
        pdfName: pdfName || null,
        notes: notes || null,
        lines: lines.map((l) => ({ name: l.name, variantIds: l.variantIds, unit: l.unit, qty: num(l.qty), unitPrice: num(l.unitPrice) })),
      };
      return initial
        ? api<Quotation>(`/quotations/${initial.id}`, { method: "PATCH", body })
        : api<Quotation>("/quotations", { method: "POST", body });
    },
    onSuccess: (q) => {
      qc.invalidateQueries({ queryKey: ["quotations"] });
      qc.invalidateQueries({ queryKey: ["accepted-prices"] });
      router.push(`/quotations/${q.id}`);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Card className="grid gap-3 md:grid-cols-2">
        {initial ? (
          <Stat label={t("client")}>{initial.client.name}</Stat>
        ) : (
          <div className="flex items-end gap-2">
            <Select
              label={t("client")}
              value={clientId}
              onChange={(e) => chooseClient(clients.find((c) => c.id === e.target.value))}
              required
              className="flex-1"
            >
              <option value="">{t("selectClient")}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.status === "PROSPECT" ? `${c.name} (${t("status.PROSPECT")})` : c.name}</option>
              ))}
            </Select>
            <Button type="button" variant="secondary" onClick={() => setAddingClient((v) => !v)}>+ {t("newClientInline")}</Button>
          </div>
        )}
        <Select label={t("project")} value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!clientId}>
          <option value="">{t("noProject")}</option>
          {projects.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        {addingClient && (
          <div className="md:col-span-2">
            <NewClient
              onCreated={(c) => {
                setAddingClient(false);
                chooseClient(c);
              }}
            />
          </div>
        )}
        <Input label={t("date")} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <Input label={t("clientRef")} hint={t("optional")} value={reference} onChange={(e) => setReference(e.target.value)} dir="ltr" />
        <Input label={t("attn")} value={attn} onChange={(e) => setAttn(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Input label={t("phone")} value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" inputMode="tel" />
          <Input label={t("email")} value={email} onChange={(e) => setEmail(e.target.value)} type="email" dir="ltr" />
        </div>
      </Card>

      <Card className="flex flex-col p-0">
        <h2 className="px-4 pt-4 font-bold">{t("lines")}</h2>
        <ul className="divide-y divide-line">
          {lines.map((l) => (
            <LineEditor
              key={l.key}
              line={l}
              clientId={clientId}
              update={(patch) => update(l.key, patch)}
              remove={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}
            />
          ))}
        </ul>
        <div className="flex flex-wrap items-end justify-between gap-2 border-t border-line p-4">
          <Button type="button" variant="secondary" onClick={() => setLines((ls) => [...ls, blank()])}>+ {t("addQuoteLine")}</Button>
          <div className="flex items-end gap-2">
            <Input label={t("oneSalePrice")} value={allPrice} onChange={(e) => setAllPrice(e.target.value)} type="number" step="any" min={0} dir="ltr" className="w-40" />
            <Button type="button" variant="secondary" disabled={allPrice === ""} onClick={() => setLines((ls) => ls.map((l) => ({ ...l, unitPrice: allPrice })))}>
              {t("applyAll")}
            </Button>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-3 border-t border-line p-4">
          <Stat label={t("subtotal")}>{formatMoney(subtotal)}</Stat>
          <Stat label={t("vat", { rate: VAT })}>{formatMoney(vat)}</Stat>
          <Stat label={t("total")} strong>{formatMoney(round2(subtotal + vat))}</Stat>
        </dl>
      </Card>

      <Card className="grid gap-3">
        <Textarea
          label={t("terms")}
          value={terms}
          onChange={(e) => (setTerms(e.target.value), setTermsTouched(true))}
          rows={6}
          dir="ltr"
          placeholder={defaultTerms({ credit: true })}
        />
        <Input label={t("pdfName")} value={pdfName} onChange={(e) => setPdfName(e.target.value)} placeholder={defaultPdfName(date)} dir="ltr" />
        <Textarea label={`${t("notes")} (${t("internalOnly")})`} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        {save.error && <Notice>{save.error.message}</Notice>}
        <div>
          <Button type="submit" disabled={save.isPending || !clientId}>{t("save")}</Button>
        </div>
      </Card>
    </form>
  );
}
