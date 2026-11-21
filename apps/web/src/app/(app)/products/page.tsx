"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Badge, Button, Card, Input, Muted, Notice, PageHeader, Select } from "@/components/ui";
import { api, formatNumber } from "@/lib/api";
import { useBrands, useMe, useProducts, useVariants } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import type { Unit, Variant } from "@/lib/types";

const UNITS: Unit[] = ["TON", "BAG", "M3", "PIECE", "KG", "METER"];
const CATEGORIES = ["STEEL", "CEMENT", "SAND", "BLOCK", "OTHER"];

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

function AddBrand() {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [nameEn, setNameEn] = useState("");
  const save = useSave<{ name: string; nameEn?: string }>("/brands");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ name, nameEn: nameEn || undefined }, { onSuccess: () => (setName(""), setNameEn("")) });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <h3 className="font-semibold">{t("newBrand")}</h3>
      {save.error && <Notice>{save.error.message}</Notice>}
      <Input label={t("nameAr")} value={name} onChange={(e) => setName(e.target.value)} required />
      <Input label={t("nameEn")} value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" />
      <Button type="submit" variant="secondary" disabled={save.isPending}>{t("add")}</Button>
    </form>
  );
}

function AddProduct() {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [category, setCategory] = useState("STEEL");
  const save = useSave<{ name: string; nameEn?: string; category: string }>("/products");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ name, nameEn: nameEn || undefined, category }, { onSuccess: () => (setName(""), setNameEn("")) });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <h3 className="font-semibold">{t("newProduct")}</h3>
      {save.error && <Notice>{save.error.message}</Notice>}
      <Input label={t("nameAr")} value={name} onChange={(e) => setName(e.target.value)} required />
      <Input label={t("nameEn")} value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" />
      <Select label={t("category")} value={category} onChange={(e) => setCategory(e.target.value)}>
        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </Select>
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
  const [supplierName, setSupplierName] = useState("");
  const save = useSave<Record<string, unknown>>("/variants");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(
      {
        productId,
        brandId: brandId || undefined,
        spec,
        unit,
        minQty: Number(minQty || 0),
        supplierName: supplierName || undefined,
      },
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
      <Input label={t("spec")} value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="16 مم" />
      <div className="grid grid-cols-2 gap-2">
        <Select label={t("unit")} value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
          {UNITS.map((u) => <option key={u} value={u}>{t(`unit.${u}`)}</option>)}
        </Select>
        <Input label={t("minQty")} value={minQty} onChange={(e) => setMinQty(e.target.value)} type="number" min={0} step="0.001" dir="ltr" required />
      </div>
      <Input label={t("supplier")} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
      <Button type="submit" disabled={save.isPending}>{t("add")}</Button>
    </form>
  );
}

function VariantRow({ v, isAdmin }: { v: Variant; isAdmin: boolean }) {
  const { t } = useI18n();
  const [minQty, setMinQty] = useState(String(v.minQty));
  const save = useSave<Record<string, unknown>>(`/variants/${v.id}`, "PATCH");
  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-3 py-2 font-semibold">{v.product.name}</td>
      <td className="px-3 py-2">{v.brand?.name ?? "—"}</td>
      <td className="px-3 py-2">{v.spec || "—"}</td>
      <td className="px-3 py-2">{t(`unit.${v.unit}`)}</td>
      <td className="px-3 py-2">
        {isAdmin ? (
          <input
            aria-label={t("minQty")}
            value={minQty}
            onChange={(e) => setMinQty(e.target.value)}
            onBlur={() => Number(minQty) !== v.minQty && save.mutate({ minQty: Number(minQty || 0) })}
            type="number"
            min={0}
            dir="ltr"
            className="min-h-9 w-24 rounded-lg border border-line px-2"
          />
        ) : (
          formatNumber(v.minQty)
        )}
      </td>
      <td className="px-3 py-2 text-muted">{v.supplierName ?? "—"}</td>
      <td className="px-3 py-2">
        {isAdmin ? (
          <button
            onClick={() => save.mutate({ isActive: !v.isActive })}
            className="min-h-9"
            aria-label={v.isActive ? t("deactivate") : t("activate")}
          >
            <Badge tone={v.isActive ? "ok" : "neutral"}>{v.isActive ? t("active") : t("inactive")}</Badge>
          </button>
        ) : (
          <Badge tone="ok">{t("active")}</Badge>
        )}
      </td>
    </tr>
  );
}

export default function ProductsPage() {
  const { t } = useI18n();
  const { data: me } = useMe();
  const isAdmin = me?.role === "ADMIN";
  const { data: variants, isLoading } = useVariants(isAdmin);

  return (
    <>
      <PageHeader title={t("products")} />
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <Card className="overflow-x-auto p-0">
          {isLoading && <Muted>{t("loading")}</Muted>}
          {variants?.length === 0 && <Muted>{t("empty")}</Muted>}
          {!!variants?.length && (
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-start text-xs text-muted">
                  {[t("product"), t("brand"), t("spec"), t("unit"), t("minQty"), t("supplier"), t("status")].map((h) => (
                    <th key={h} className="px-3 py-2 text-start font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {variants.map((v) => <VariantRow key={v.id} v={v} isAdmin={isAdmin} />)}
              </tbody>
            </table>
          )}
        </Card>
        {isAdmin && (
          <div className="flex flex-col gap-4">
            <Card><AddVariant /></Card>
            <Card><AddProduct /></Card>
            <Card><AddBrand /></Card>
          </div>
        )}
      </div>
    </>
  );
}
