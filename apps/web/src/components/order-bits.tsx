"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { api } from "@/lib/api";
import { categoryName, DEFAULT_ZONE, zoneName, zonesOf } from "@/lib/catalogue";
import { useI18n } from "@/lib/i18n";
import { statusTone } from "@/lib/orders";
import type { ClientProject, OrderStatus, Variant } from "@/lib/types";
import { Badge, Button, Input, Notice, Select, Textarea } from "./ui";

export function StatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useI18n();
  return <Badge tone={statusTone(status)}>{t(`orderStatus.${status}`)}</Badge>;
}

/** A button that asks for a reason inline before doing something that is kept on record (remove, cancel). */
export function ReasonAction({
  label,
  onConfirm,
  variant = "ghost",
  className,
}: {
  label: string;
  onConfirm: (reason: string) => Promise<unknown>;
  variant?: "ghost" | "danger" | "secondary";
  className?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <Button type="button" variant={variant} className={className} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      setOpen(false);
      setReason("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex w-full flex-wrap items-end gap-2 rounded-xl bg-canvas p-2">
      <Input
        label={t("reason")}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
        minLength={2}
        autoFocus
        className="min-w-48 flex-1"
      />
      <Button type="submit" variant="danger" disabled={busy}>{t("confirm")}</Button>
      <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t("cancel")}</Button>
      {error && <div className="w-full"><Notice>{error}</Notice></div>}
    </form>
  );
}

/** Add or edit a client's project (site): name, Google Maps link, contacts. */
export function ProjectForm({
  clientId,
  project,
  onDone,
}: {
  clientId: string;
  project?: ClientProject;
  onDone: (p: ClientProject) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = useState(project?.name ?? "");
  const [mapsUrl, setMapsUrl] = useState(project?.mapsUrl ?? "");
  const [contacts, setContacts] = useState(project?.contacts ?? "");
  const save = useMutation({
    mutationFn: () =>
      api<ClientProject>(project ? `/clients/${clientId}/projects/${project.id}` : `/clients/${clientId}/projects`, {
        method: project ? "PATCH" : "POST",
        body: { name, mapsUrl: mapsUrl.trim() || null, contacts: contacts.trim() || null },
      }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["projects", clientId] });
      onDone(p);
    },
  });
  return (
    // A group, not a <form>: it is also used inside the new-order form, and forms can't nest.
    <div role="group" className="flex flex-col gap-2 rounded-xl border border-line p-3">
      {save.error && <Notice>{save.error.message}</Notice>}
      <Input label={t("projectName")} value={name} onChange={(e) => setName(e.target.value)} required />
      <Input
        label={t("mapsUrl")}
        value={mapsUrl}
        onChange={(e) => setMapsUrl(e.target.value)}
        type="url"
        dir="ltr"
        placeholder="https://maps.app.goo.gl/…"
      />
      <Textarea
        label={t("siteContacts")}
        value={contacts}
        onChange={(e) => setContacts(e.target.value)}
        placeholder="م. أحمد 0551234567"
        rows={3}
      />
      <div className="flex gap-2">
        <Button type="button" disabled={save.isPending || !name.trim()} onClick={() => save.mutate()}>
          {t("save")}
        </Button>
      </div>
    </div>
  );
}

/** Region → category → brand → item, with search; the same filters as the products page. */
export function ItemPicker({
  variants,
  value,
  onChange,
  required = false,
}: {
  variants: Variant[];
  value: string;
  onChange: (variantId: string) => void;
  /** Only where the picker is the form's own field (not in the new-order form, which adds lines from it). */
  required?: boolean;
}) {
  const { t, locale } = useI18n();
  const zones = useMemo(() => zonesOf(variants), [variants]);
  const [zone, setZone] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [q, setQ] = useState("");
  const activeZone = zone ?? (zones.includes(DEFAULT_ZONE) ? DEFAULT_ZONE : "");

  const inZone = variants.filter((v) => !activeZone || !v.zones.length || v.zones.some((z) => z.zone === activeZone));
  const categories = [...new Set(inZone.map((v) => v.product.category))].sort();
  const activeCategory = categories.includes(category) ? category : "";
  const inCategory = inZone.filter((v) => !activeCategory || v.product.category === activeCategory);
  const brands = [...new Set(inCategory.map((v) => v.brand?.name ?? ""))].filter(Boolean).sort();
  const activeBrand = brands.includes(brand) ? brand : "";
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const options = inCategory
    .filter((v) => !activeBrand || v.brand?.name === activeBrand)
    .filter((v) => {
      const text = `${v.product.name} ${v.erpName ?? ""} ${v.brand?.name ?? ""} ${v.spec}`.toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .sort((a, b) => a.product.name.localeCompare(b.product.name, undefined, { numeric: true }));
  const selected = variants.find((v) => v.id === value);

  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Select label={t("region")} value={activeZone} onChange={(e) => setZone(e.target.value)}>
        <option value="">{t("allRegions")}</option>
        {zones.map((z) => <option key={z} value={z}>{zoneName(z, locale)}</option>)}
      </Select>
      <Select label={t("category")} value={activeCategory} onChange={(e) => setCategory(e.target.value)}>
        <option value="">{t("allCategories")}</option>
        {categories.map((c) => <option key={c} value={c}>{categoryName(c, locale)}</option>)}
      </Select>
      <Select label={t("brand")} value={activeBrand} onChange={(e) => setBrand(e.target.value)}>
        <option value="">{t("allBrands")}</option>
        {brands.map((b) => <option key={b} value={b}>{b}</option>)}
      </Select>
      <Input label={t("search")} value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder={t("searchProducts")} />
      <Select
        label={t("item")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="col-span-2 lg:col-span-4"
      >
        <option value="">{`${t("chooseItem")} (${options.length})`}</option>
        {selected && !options.includes(selected) && (
          <option value={selected.id}>{`${selected.product.name} — ${selected.brand?.name ?? ""}`}</option>
        )}
        {options.map((v) => (
          <option key={v.id} value={v.id}>
            {[v.product.name, v.spec, v.brand?.name].filter(Boolean).join(" — ")}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Small "label: value" pair used in summaries. */
export function Stat({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={strong ? "text-lg font-bold" : "font-semibold"}>
        <bdi>{children}</bdi>
      </dd>
    </div>
  );
}
