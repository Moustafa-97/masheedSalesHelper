"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { zoneName, zonesOf } from "@/lib/catalogue";
import { useClients, useVariants } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { LOST_REASONS, MANUAL_SOURCES } from "@/lib/market";
import { today } from "@/lib/orders";
import type { LostDealDetail, LostReason, MarketPrice, PriceSource, Unit } from "@/lib/types";
import { CompetitorInput, itemName, LinkedItems, MarketHint, TermsSelect } from "./market-bits";
import { Button, Card, Input, Notice, Select, Textarea } from "./ui";

const UNITS: Unit[] = ["TON", "BAG", "PIECE", "M3", "KG", "METER", "GALLON", "TRAILER"];
const num = (s: string) => (s.trim() === "" ? null : Number(s));

/** Everything that shows market data is refreshed after a change. */
function useRefreshMarket() {
  const qc = useQueryClient();
  return () => {
    for (const key of ["market-prices", "lost-deals", "market-analysis", "competitors"]) qc.invalidateQueries({ queryKey: [key] });
  };
}

function ZoneSelect({ value, onChange }: { value: string; onChange: (z: string) => void }) {
  const { t, locale } = useI18n();
  const { data: variants = [] } = useVariants();
  return (
    <Select label={t("zone")} hint={t("optional")} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {zonesOf(variants).map((z) => <option key={z} value={z}>{zoneName(z, locale)}</option>)}
    </Select>
  );
}

/* ---------- Lost deal ---------- */

interface DealLine {
  key: number;
  name: string;
  variantIds: string[];
  unit: Unit;
  qty: string;
  ourPrice: string;
  competitorPrice: string;
}
let seq = 0;
const blankLine = (): DealLine => ({ key: ++seq, name: "", variantIds: [], unit: "TON", qty: "", ourPrice: "", competitorPrice: "" });

export function LostDealForm({ initial, onSaved }: { initial?: LostDealDetail; onSaved: (d: LostDealDetail) => void }) {
  const { t } = useI18n();
  const refresh = useRefreshMarket();
  const { data: clients = [] } = useClients();
  const [date, setDate] = useState(initial?.date ?? today());
  const [clientId, setClientId] = useState(initial?.client.id ?? "");
  const [clientName, setClientName] = useState(initial && !initial.client.id ? initial.client.name : "");
  const [zone, setZone] = useState(initial?.zone ?? "");
  const [reason, setReason] = useState<LostReason | "">(initial?.reason ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [competitor, setCompetitor] = useState(initial?.competitor?.name ?? "");
  const [creditDays, setCreditDays] = useState(initial?.creditDays ?? 0);
  const [theirDays, setTheirDays] = useState(initial?.competitorCreditDays ?? 0);
  const [lines, setLines] = useState<DealLine[]>(
    initial?.lines.map((l) => ({
      key: ++seq,
      name: l.name,
      variantIds: l.variantIds,
      unit: l.unit,
      qty: String(l.qty),
      ourPrice: l.ourPrice === null ? "" : String(l.ourPrice),
      competitorPrice: l.competitorPrice === null ? "" : String(l.competitorPrice),
    })) ?? [blankLine()],
  );
  const update = (key: number, patch: Partial<DealLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  /** A client from the system takes its payment terms; otherwise they're chosen by hand. */
  const chooseClient = (id: string) => {
    setClientId(id);
    const c = clients.find((x) => x.id === id);
    if (c) setCreditDays(c.creditLimit > 0 ? c.paymentTermsDays : 0);
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        date,
        clientId: clientId || null,
        clientName: clientId ? null : clientName,
        zone: zone || null,
        reason,
        note: note || null,
        competitor: competitor || null,
        creditDays,
        competitorCreditDays: theirDays,
        lines: lines.map((l) => ({
          name: l.name,
          variantIds: l.variantIds,
          unit: l.unit,
          qty: Number(l.qty),
          ourPrice: num(l.ourPrice),
          competitorPrice: num(l.competitorPrice),
        })),
      };
      return initial
        ? api<LostDealDetail>(`/lost-deals/${initial.id}`, { method: "PATCH", body })
        : api<LostDealDetail>("/lost-deals", { method: "POST", body });
    },
    onSuccess: (d) => {
      refresh();
      onSaved(d);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Card className="grid gap-3 md:grid-cols-3">
        <Select label={t("client")} value={clientId} onChange={(e) => chooseClient(e.target.value)}>
          <option value="">{t("clientNotInSystem")}</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        {!clientId && <Input label={t("clientName")} value={clientName} onChange={(e) => setClientName(e.target.value)} required />}
        <ZoneSelect value={zone} onChange={setZone} />
        <Input label={t("date")} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <Select label={t("reason")} value={reason} onChange={(e) => setReason(e.target.value as LostReason)} required>
          <option value="">—</option>
          {LOST_REASONS.map((r) => <option key={r} value={r}>{t(`lostReason.${r}`)}</option>)}
        </Select>
        <CompetitorInput label={t("competitor")} value={competitor} onChange={setCompetitor} />
        <Textarea label={reason === "OTHER" ? t("note") : `${t("note")} (${t("optional")})`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} required={reason === "OTHER"} className="md:col-span-3" />
        <TermsSelect label={t("ourTerms")} value={creditDays} onChange={setCreditDays} />
        <TermsSelect label={t("theirTerms")} value={theirDays} onChange={setTheirDays} />
      </Card>

      <Card className="flex flex-col p-0">
        <h2 className="px-4 pt-4 font-bold">{t("lines")}</h2>
        <ul className="divide-y divide-line">
          {lines.map((l) => (
            <li key={l.key} className="flex flex-col gap-2 px-4 py-3">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
                <Input label={t("lineName")} placeholder={t("lineNameHint")} value={l.name} onChange={(e) => update(l.key, { name: e.target.value })} required className="col-span-2 md:col-span-1" />
                <Select label={t("unit")} value={l.unit} onChange={(e) => update(l.key, { unit: e.target.value as Unit })}>
                  {UNITS.map((u) => <option key={u} value={u}>{t(`unit.${u}`)}</option>)}
                </Select>
                <Input label={t("qty")} value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} type="number" step="any" min={0.001} required dir="ltr" />
                <Input label={t("ourPrice")} hint={t("optional")} value={l.ourPrice} onChange={(e) => update(l.key, { ourPrice: e.target.value })} type="number" step="any" min={0} dir="ltr" />
                <Input label={t("competitorPrice")} hint={t("optional")} value={l.competitorPrice} onChange={(e) => update(l.key, { competitorPrice: e.target.value })} type="number" step="any" min={0} dir="ltr" />
                <div className="flex items-end">
                  <Button type="button" variant="ghost" aria-label={t("remove")} onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}>✕</Button>
                </div>
              </div>
              <MarketHint variantIds={l.variantIds} creditDays={creditDays} />
              <LinkedItems
                variantIds={l.variantIds}
                onChange={(variantIds) => update(l.key, { variantIds })}
                onFirst={(v) => update(l.key, { unit: v.unit, ...(!l.name && { name: itemName(v) }) })}
              />
            </li>
          ))}
        </ul>
        <div className="border-t border-line p-4">
          <Button type="button" variant="secondary" onClick={() => setLines((ls) => [...ls, blankLine()])}>+ {t("addQuoteLine")}</Button>
        </div>
      </Card>
      {save.error && <Notice>{save.error.message}</Notice>}
      <div>
        <Button type="submit" disabled={save.isPending}>{t("save")}</Button>
      </div>
    </form>
  );
}

/* ---------- Market price ---------- */

export function MarketPriceForm({ initial, onDone }: { initial?: MarketPrice; onDone: () => void }) {
  const { t } = useI18n();
  const refresh = useRefreshMarket();
  const [date, setDate] = useState(initial?.date ?? today());
  const [name, setName] = useState(initial?.name ?? "");
  const [variantIds, setVariantIds] = useState<string[]>(initial?.variantIds ?? []);
  const [unit, setUnit] = useState<Unit>(initial?.unit ?? "TON");
  const [price, setPrice] = useState(initial ? String(initial.price) : "");
  const [creditDays, setCreditDays] = useState(initial?.creditDays ?? 0);
  const [competitor, setCompetitor] = useState(initial?.competitor?.name ?? "");
  const [zone, setZone] = useState(initial?.zone ?? "");
  const [source, setSource] = useState<PriceSource>(initial?.source ?? "MARKET");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const save = useMutation({
    mutationFn: () => {
      const body = {
        date,
        name,
        variantIds,
        unit,
        price: Number(price),
        creditDays,
        competitor: competitor || null,
        zone: zone || null,
        source,
        notes: notes || null,
      };
      return initial
        ? api<MarketPrice>(`/market-prices/${initial.id}`, { method: "PATCH", body })
        : api<MarketPrice>("/market-prices", { method: "POST", body });
    },
    onSuccess: () => {
      refresh();
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-4">
      <Input label={t("lineName")} placeholder={t("lineNameHint")} value={name} onChange={(e) => setName(e.target.value)} required className="md:col-span-2" />
      <CompetitorInput label={t("competitorOrBrand")} value={competitor} onChange={setCompetitor} />
      <Select label={t("source")} value={source} onChange={(e) => setSource(e.target.value as PriceSource)}>
        {MANUAL_SOURCES.map((s) => <option key={s} value={s}>{t(`priceSource.${s}`)}</option>)}
      </Select>
      <div className="md:col-span-4">
        <LinkedItems variantIds={variantIds} onChange={setVariantIds} onFirst={(v) => (setUnit(v.unit), !name && setName(itemName(v)))} />
      </div>
      <Input label={t("price")} hint={t("exclVat")} value={price} onChange={(e) => setPrice(e.target.value)} type="number" step="any" min={0.01} required dir="ltr" />
      <Select label={t("unit")} value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
        {UNITS.map((u) => <option key={u} value={u}>{t(`unit.${u}`)}</option>)}
      </Select>
      <TermsSelect label={t("paymentTerms")} value={creditDays} onChange={setCreditDays} />
      <Input label={t("date")} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      <ZoneSelect value={zone} onChange={setZone} />
      <Input label={t("notes")} hint={t("optional")} value={notes} onChange={(e) => setNotes(e.target.value)} className="md:col-span-3" />
      {save.error && <div className="md:col-span-4"><Notice>{save.error.message}</Notice></div>}
      <div className="flex gap-2 md:col-span-4">
        <Button type="submit" disabled={save.isPending}>{t("save")}</Button>
        <Button type="button" variant="secondary" onClick={onDone}>{t("cancel")}</Button>
      </div>
    </form>
  );
}
