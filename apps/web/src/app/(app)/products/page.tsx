"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { Badge, Button, Card, Input, Muted, Notice, PageHeader, Select } from "@/components/ui";
import { api, formatNumber } from "@/lib/api";
import { categoryName, DEFAULT_ZONE, loadLabel, zoneName, zonesOf } from "@/lib/catalogue";
import { useBrands, useMe, useProducts, useVariants } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import type { ImportSummary, Unit, Variant } from "@/lib/types";

const UNITS: Unit[] = ["TON", "BAG", "PIECE", "M3", "KG", "METER", "GALLON", "TRAILER"];
const ZONE_KEY = "products.zone";

function useSave<T>(path: string, method: "POST" | "PATCH" = "POST") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: T) => api(path, { method, body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["variants"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["brands"] });
    },
  });
}

/* ---------- ERP import ---------- */

function ImportButton() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api<ImportSummary>("/products/import", { method: "POST", body: form });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["variants"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["brands"] });
    },
  });
  const s = upload.data;
  return (
    <div className="flex flex-col items-end gap-2">
      <input
        ref={input}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file);
          e.target.value = "";
        }}
      />
      <Button variant="accent" onClick={() => input.current?.click()} disabled={upload.isPending} title={t("importHint")}>
        {upload.isPending ? t("importing") : t("importErp")}
      </Button>
      {upload.error && <Notice>{upload.error.message}</Notice>}
      {s && (
        <Notice tone="ok">
          {t("importDone")}:{" "}
          {t("importSummary", {
            items: s.items,
            rows: s.rows,
            created: s.variantsCreated,
            updated: s.variantsUpdated,
            products: s.productsCreated,
            notInFile: s.notInFile,
          })}
        </Notice>
      )}
    </div>
  );
}

/* ---------- One catalogue item ---------- */

function ProductName({ v, isAdmin }: { v: Variant; isAdmin: boolean }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(v.product.name);
  const save = useSave<{ name: string }>(`/products/${v.productId}`, "PATCH");
  if (editing) {
    return (
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ name }, { onSuccess: () => setEditing(false) });
        }}
      >
        <input
          aria-label={t("renameProduct")}
          title={t("renameHint")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-h-9 min-w-0 flex-1 rounded-lg border border-line px-2 font-semibold"
          autoFocus
          required
        />
        <Button type="submit" variant="secondary" className="min-h-9" disabled={save.isPending}>{t("save")}</Button>
        <Button type="button" variant="ghost" className="min-h-9" onClick={() => (setEditing(false), setName(v.product.name))}>
          {t("cancel")}
        </Button>
        {save.error && <span className="w-full text-xs text-danger">{save.error.message}</span>}
      </form>
    );
  }
  return (
    <div className="flex items-start gap-1">
      <span className="font-semibold leading-snug" dir="auto">{v.product.name}</span>
      {isAdmin && (
        <button
          onClick={() => setEditing(true)}
          className="-my-1 min-h-8 min-w-8 rounded-lg text-muted hover:bg-brand-50 hover:text-brand-700"
          aria-label={t("renameProduct")}
          title={t("renameHint")}
        >
          ✎
        </button>
      )}
    </div>
  );
}

function MinQty({ v, isAdmin }: { v: Variant; isAdmin: boolean }) {
  const { t } = useI18n();
  const [value, setValue] = useState(v.minQty === null ? "" : String(v.minQty));
  const save = useSave<{ minQty: number | null }>(`/variants/${v.id}`, "PATCH");
  if (!isAdmin) {
    return <span className="text-sm">{v.minQty === null ? <span className="text-muted">{t("notSet")}</span> : `${formatNumber(v.minQty)} ${t(`unit.${v.unit}`)}`}</span>;
  }
  return (
    <label className="flex items-center gap-1 text-sm">
      <input
        aria-label={t("minQty")}
        title={t("minQtyClear")}
        value={value}
        placeholder="—"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const next = value.trim() === "" ? null : Number(value);
          if (next !== v.minQty && (next === null || Number.isFinite(next))) save.mutate({ minQty: next });
        }}
        type="number"
        min={0}
        step="any"
        dir="ltr"
        className="min-h-9 w-24 rounded-lg border border-line px-2"
      />
      <span className="text-muted">{t(`unit.${v.unit}`)}</span>
      {save.isPending && <span className="text-xs text-muted">…</span>}
    </label>
  );
}

function ItemRow({ v, zone, isAdmin }: { v: Variant; zone: string; isAdmin: boolean }) {
  const { t, locale } = useI18n();
  const toggle = useSave<{ isActive: boolean }>(`/variants/${v.id}`, "PATCH");
  // Truck loads ("580 كيس") only; a plain unit like "طن" already shows next to the minimum.
  const loads = zone ? v.zones.filter((z) => z.zone === zone && z.loadQty !== null) : [];
  const regions = zone ? [] : [...new Set(v.zones.map((z) => z.zone))];

  return (
    <li className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 ${v.isActive ? "" : "opacity-60"}`}>
      <div className="min-w-0 flex-[1_1_260px]">
        <ProductName v={v} isAdmin={isAdmin} />
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <Badge tone="info">{v.brand?.name ?? t("noBrand")}</Badge>
          {v.spec && <span>{v.spec}</span>}
          {v.erpName && v.erpName !== v.product.name && (
            <span className="truncate" dir="ltr" title={`${t("erpName")}: ${v.erpName}`}>{v.erpName}</span>
          )}
        </div>
      </div>

      <div className="flex flex-[1_1_200px] flex-wrap gap-1" aria-label={t("loads")}>
        {loads.map((z) => (
          <span key={z.id} className="rounded-lg bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-800">
            {loadLabel(z, locale)}
          </span>
        ))}
        {!zone && regions.length > 0 && (
          <span className="text-xs text-muted" title={regions.map((r) => zoneName(r, locale)).join("، ")}>
            {regions.length <= 3 ? regions.map((r) => zoneName(r, locale)).join("، ") : `${t("allRegions")}: ${regions.length}`}
          </span>
        )}
        {v.colors.length > 0 && (
          <details className="w-full text-xs text-muted">
            <summary className="cursor-pointer select-none">{t("colors")}: {v.colors.length}</summary>
            <p className="mt-1" dir="ltr">{v.colors.join(" · ")}</p>
          </details>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Keyed on the saved value so the field resets when the data changes. */}
        <MinQty key={String(v.minQty)} v={v} isAdmin={isAdmin} />
        {isAdmin ? (
          <button
            onClick={() => toggle.mutate({ isActive: !v.isActive })}
            className="min-h-9"
            aria-label={v.isActive ? t("deactivate") : t("activate")}
          >
            <Badge tone={v.isActive ? "ok" : "neutral"}>{v.isActive ? t("active") : t("inactive")}</Badge>
          </button>
        ) : null}
      </div>
    </li>
  );
}

/* ---------- Manual add (for items outside the ERP file) ---------- */

function AddBrand() {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const save = useSave<{ name: string }>("/brands");
  return (
    <form
      onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate({ name }, { onSuccess: () => setName("") }))}
      className="flex flex-col gap-2"
    >
      <h3 className="font-semibold">{t("newBrand")}</h3>
      {save.error && <Notice>{save.error.message}</Notice>}
      <Input label={t("name")} value={name} onChange={(e) => setName(e.target.value)} required />
      <Button type="submit" variant="secondary" disabled={save.isPending}>{t("add")}</Button>
    </form>
  );
}

function AddProduct({ categories }: { categories: string[] }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const save = useSave<{ name: string; category: string }>("/products");
  return (
    <form
      onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate({ name, category }, { onSuccess: () => setName("") }))}
      className="flex flex-col gap-2"
    >
      <h3 className="font-semibold">{t("newProduct")}</h3>
      {save.error && <Notice>{save.error.message}</Notice>}
      <Input label={t("name")} value={name} onChange={(e) => setName(e.target.value)} required />
      <Input label={t("category")} value={category} onChange={(e) => setCategory(e.target.value)} list="categories" required />
      <datalist id="categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <Button type="submit" variant="secondary" disabled={save.isPending}>{t("add")}</Button>
    </form>
  );
}

function AddVariant() {
  const { t } = useI18n();
  const { data: products = [] } = useProducts();
  const { data: brands = [] } = useBrands();
  const [productId, setProductId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [spec, setSpec] = useState("");
  const [unit, setUnit] = useState<Unit>("TON");
  const [minQty, setMinQty] = useState("");
  const save = useSave<Record<string, unknown>>("/variants");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(
      { productId, brandId: brandId || undefined, spec, unit, minQty: minQty === "" ? null : Number(minQty) },
      { onSuccess: () => (setSpec(""), setMinQty("")) },
    );
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <h3 className="font-semibold">{t("newVariant")}</h3>
      {save.error && <Notice>{save.error.message}</Notice>}
      <Select label={t("product")} value={productId} onChange={(e) => setProductId(e.target.value)} required>
        <option value="">—</option>
        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>
      <Select label={t("brand")} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
        <option value="">{t("noBrand")}</option>
        {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </Select>
      <Input label={t("spec")} value={spec} onChange={(e) => setSpec(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <Select label={t("unit")} value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
          {UNITS.map((u) => <option key={u} value={u}>{t(`unit.${u}`)}</option>)}
        </Select>
        <Input label={t("minQty")} value={minQty} onChange={(e) => setMinQty(e.target.value)} type="number" min={0} step="any" dir="ltr" />
      </div>
      <Button type="submit" disabled={save.isPending}>{t("add")}</Button>
    </form>
  );
}

/* ---------- Page ---------- */

const matches = (v: Variant, q: string) => {
  const text = `${v.product.name} ${v.erpName ?? ""} ${v.brand?.name ?? ""} ${v.spec}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => text.includes(w));
};

export default function ProductsPage() {
  const { t, locale } = useI18n();
  const { data: me } = useMe();
  const isAdmin = me?.role === "ADMIN";
  const [showInactive, setShowInactive] = useState(false);
  const { data: all = [], isLoading } = useVariants(isAdmin);

  const [zone, setZone] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [q, setQ] = useState("");
  // The region chosen on the last visit (read once, on the client).
  const [savedZone] = useState<string | null>(() => {
    try {
      return typeof window === "undefined" ? null : localStorage.getItem(ZONE_KEY);
    } catch {
      return null;
    }
  });

  const zones = useMemo(() => zonesOf(all), [all]);
  const fallbackZone =
    savedZone !== null && (savedZone === "" || zones.includes(savedZone))
      ? savedZone
      : zones.includes(DEFAULT_ZONE)
        ? DEFAULT_ZONE
        : "";
  const activeZone = zone ?? fallbackZone;
  const changeZone = (z: string) => {
    setZone(z);
    try {
      localStorage.setItem(ZONE_KEY, z);
    } catch {
      /* storage unavailable */
    }
  };

  // Items added by hand have no regions, so they show everywhere.
  const inZone = useMemo(
    () =>
      all.filter(
        (v) => (showInactive || v.isActive) && (!activeZone || !v.zones.length || v.zones.some((z) => z.zone === activeZone)),
      ),
    [all, activeZone, showInactive],
  );
  const categories = useMemo(() => [...new Set(inZone.map((v) => v.product.category))].sort(), [inZone]);
  // A filter whose option disappeared (after changing region or category) counts as "all".
  const activeCategory = categories.includes(category) ? category : "";
  const inCategory = useMemo(
    () => inZone.filter((v) => !activeCategory || v.product.category === activeCategory),
    [inZone, activeCategory],
  );
  const brands = useMemo(
    () => [...new Set(inCategory.map((v) => v.brand?.name ?? ""))].filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [inCategory],
  );
  const activeBrand = brands.includes(brand) ? brand : "";

  const visible = useMemo(
    () =>
      inCategory
        .filter((v) => (!activeBrand || v.brand?.name === activeBrand) && (!q || matches(v, q)))
        .sort(
          (a, b) =>
            a.product.category.localeCompare(b.product.category) ||
            a.product.name.localeCompare(b.product.name, undefined, { numeric: true }) ||
            (a.brand?.name ?? "").localeCompare(b.brand?.name ?? ""),
        ),
    [inCategory, activeBrand, q],
  );
  const groups = useMemo(() => {
    const map = new Map<string, Variant[]>();
    for (const v of visible) map.set(v.product.category, [...(map.get(v.product.category) ?? []), v]);
    return [...map];
  }, [visible]);

  return (
    <>
      <PageHeader
        title={t("products")}
        subtitle={all.length ? t("itemsCount", { n: visible.length }) : undefined}
        actions={isAdmin ? <ImportButton /> : undefined}
      />

      <Card className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 lg:sticky lg:top-0 lg:z-10 lg:grid-cols-4">
        <Select label={t("region")} value={activeZone} onChange={(e) => changeZone(e.target.value)}>
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
        <Input
          label={t("search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchProducts")}
          type="search"
          className="col-span-2 lg:col-span-1"
        />
        {isAdmin && (
          <label className="col-span-2 flex items-center gap-2 text-sm text-muted lg:col-span-4">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="size-4" />
            {t("showInactive")}
          </label>
        )}
      </Card>

      {isLoading && <Muted>{t("loading")}</Muted>}
      {!isLoading && !visible.length && <Muted>{t("empty")}</Muted>}
      <div className="flex flex-col gap-4">
        {groups.map(([cat, items]) => (
          <Card key={cat} className="p-0">
            <h2 className="flex items-center justify-between border-b border-line px-4 py-2 text-sm font-bold text-brand-800">
              <span>{categoryName(cat, locale)}</span>
              <span className="text-xs font-normal text-muted">{t("itemsCount", { n: items.length })}</span>
            </h2>
            <ul className="divide-y divide-line">
              {items.map((v) => <ItemRow key={v.id} v={v} zone={activeZone} isAdmin={isAdmin} />)}
            </ul>
          </Card>
        ))}
      </div>

      {isAdmin && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-semibold text-brand-700">{t("addManually")}</summary>
          <div className="mt-3 grid gap-4 md:grid-cols-3">
            <Card><AddVariant /></Card>
            <Card><AddProduct categories={categories} /></Card>
            <Card><AddBrand /></Card>
          </div>
        </details>
      )}
    </>
  );
}
