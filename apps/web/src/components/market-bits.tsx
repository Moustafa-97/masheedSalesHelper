"use client";

import { useId, useState } from "react";
import { useCompetitors, useLatestMarket, useVariants } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { CREDIT_OPTIONS } from "@/lib/market";
import { formatMoney } from "@/lib/orders";
import type { Variant } from "@/lib/types";
import { isolate } from "./credit-panel";
import { ItemPicker } from "./order-bits";
import { Button, Input, Select } from "./ui";

/** "كاش" or "آجل 45 يوم". */
export function useTerms() {
  const { t } = useI18n();
  return (days: number) => (days > 0 ? t("creditDaysTerms", { days }) : t("cash"));
}

/** Cash or credit days: the common choices, or any number of days. */
export function TermsSelect({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: number;
  onChange: (days: number) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const terms = useTerms();
  const [custom, setCustom] = useState(!CREDIT_OPTIONS.includes(value));
  if (custom) {
    return (
      <div className={className}>
        <Input
          label={label}
          hint={t("days")}
          type="number"
          min={0}
          max={365}
          step={1}
          dir="ltr"
          value={String(value)}
          onChange={(e) => onChange(Math.max(0, Math.min(365, Math.round(Number(e.target.value) || 0))))}
        />
        <button type="button" className="mt-1 text-xs text-brand-700" onClick={() => setCustom(false)}>
          {t("commonTerms")}
        </button>
      </div>
    );
  }
  return (
    <Select
      label={label}
      className={className}
      value={String(value)}
      onChange={(e) => (e.target.value === "custom" ? setCustom(true) : onChange(Number(e.target.value)))}
    >
      {CREDIT_OPTIONS.map((d) => (
        <option key={d} value={d}>{terms(d)}</option>
      ))}
      <option value="custom">{t("otherDays")}</option>
    </Select>
  );
}

/** Type a competitor: the list suggests the names already used, a new name is added to it. */
export function CompetitorInput({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (name: string) => void;
  required?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const { data: competitors = [] } = useCompetitors();
  const known = competitors.some((c) => c.name.toLowerCase() === value.trim().toLowerCase());
  return (
    <div className="flex flex-col">
      <Input
        label={label}
        hint={value.trim() && !known ? t("newCompetitor") : t("optional")}
        list={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        autoComplete="off"
      />
      <datalist id={id}>
        {competitors.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
    </div>
  );
}

/**
 * Under a price: the latest market price for the linked items at the same payment terms, and the
 * latest at other terms when it's different (2750 cash is not 2830 on 45 days).
 */
export function MarketHint({ variantIds, creditDays }: { variantIds: string[]; creditDays: number }) {
  const { t } = useI18n();
  const terms = useTerms();
  const { data = [] } = useLatestMarket(variantIds);
  const rows = data.filter((r) => variantIds.includes(r.variantId));
  if (!rows.length) return null;
  const same = rows.filter((r) => r.creditDays === creditDays).sort((a, b) => b.date.localeCompare(a.date))[0];
  const other = rows.filter((r) => r.creditDays !== creditDays).sort((a, b) => b.date.localeCompare(a.date))[0];
  const line = (r: (typeof rows)[number]) =>
    t("marketHint", {
      price: isolate(formatMoney(r.price)),
      terms: terms(r.creditDays),
      who: r.competitor ? ` · ${r.competitor}` : "",
      date: isolate(r.date),
    });
  return (
    <div className="flex flex-col text-xs text-info">
      {same && <p>{line(same)}</p>}
      {other && (!same || other.date > same.date) && <p className="text-muted">{line(other)}</p>}
    </div>
  );
}

/** The catalogue items a typed name stands for (e.g. "Rajhi 12-32" → every diameter). */
export function LinkedItems({
  variantIds,
  onChange,
  onFirst,
}: {
  variantIds: string[];
  onChange: (ids: string[]) => void;
  /** Called with the first item linked, to fill the name and the unit. */
  onFirst?: (v: Variant) => void;
}) {
  const { t } = useI18n();
  const { data: variants = [] } = useVariants();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState("");
  const byId = new Map(variants.map((v) => [v.id, v]));
  const link = () => {
    const v = byId.get(pick);
    if (!v || variantIds.includes(v.id)) return;
    if (variantIds.length === 0) onFirst?.(v);
    onChange([...variantIds, v.id]);
    setPick("");
    setOpen(false);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span className="text-muted">{t("linkedItems")}:</span>
        {variantIds.map((id) => {
          const v = byId.get(id);
          return (
            <span key={id} className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-2 py-1 text-brand-800">
              {v ? [v.product.name, v.brand?.name].filter(Boolean).join(" — ") : id.slice(0, 8)}
              <button type="button" aria-label={t("remove")} onClick={() => onChange(variantIds.filter((x) => x !== id))}>✕</button>
            </span>
          );
        })}
        {!open && (
          <button type="button" className="font-semibold text-brand-700" onClick={() => setOpen(true)}>+ {t("linkItem")}</button>
        )}
      </div>
      {open && (
        <div className="flex flex-col gap-2 rounded-xl bg-canvas p-3">
          <ItemPicker variants={variants} value={pick} onChange={setPick} />
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={link} disabled={!pick}>+ {t("linkItem")}</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export const itemName = (v: Variant) => [v.product.name, v.brand?.name].filter(Boolean).join(" — ");
