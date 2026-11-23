"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useMe, useUsers } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import type { Client, ClientStatus } from "@/lib/types";
import { Button, Card, Input, Notice, Select, Textarea } from "./ui";

type FormState = {
  name: string;
  code: string;
  status: ClientStatus;
  city: string;
  address: string;
  crNumber: string;
  vatNumber: string;
  purchasingName: string;
  purchasingPhone: string;
  purchasingEmail: string;
  notes: string;
  paymentTermsDays: string;
  creditLimit: string;
  openingBalance: string;
  repId: string;
};

const fromClient = (c?: Client): FormState => ({
  name: c?.name ?? "",
  code: c?.code ?? "",
  status: c?.status ?? "ACTIVE",
  city: c?.city ?? "",
  address: c?.address ?? "",
  crNumber: c?.crNumber ?? "",
  vatNumber: c?.vatNumber ?? "",
  purchasingName: c?.purchasingName ?? "",
  purchasingPhone: c?.purchasingPhone ?? "",
  purchasingEmail: c?.purchasingEmail ?? "",
  notes: c?.notes ?? "",
  paymentTermsDays: String(c?.paymentTermsDays ?? 0),
  creditLimit: String(c?.creditLimit ?? 0),
  openingBalance: String(c?.openingBalance ?? 0),
  repId: c?.repId ?? "",
});

/** Only sends fields that have a value; credit fields only when the user is an admin. */
function toPayload(f: FormState, isAdmin: boolean, original?: Client) {
  const text = (v: string) => (v.trim() === "" ? undefined : v.trim());
  const body: Record<string, unknown> = {
    name: f.name.trim(),
    code: text(f.code),
    status: f.status,
    city: text(f.city),
    address: text(f.address),
    crNumber: text(f.crNumber),
    vatNumber: text(f.vatNumber),
    purchasingName: text(f.purchasingName),
    purchasingPhone: text(f.purchasingPhone),
    purchasingEmail: text(f.purchasingEmail),
    notes: text(f.notes),
  };
  if (isAdmin) {
    body.paymentTermsDays = Number(f.paymentTermsDays);
    body.creditLimit = Number(f.creditLimit || 0);
    body.openingBalance = Number(f.openingBalance || 0);
    if (f.repId && f.repId !== original?.repId) body.repId = f.repId;
  }
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
}

export function ClientForm({ client, onSaved }: { client?: Client; onSaved: (c: Client) => void }) {
  const { t } = useI18n();
  const { data: me } = useMe();
  const isAdmin = me?.role === "ADMIN";
  const { data: users = [] } = useUsers(isAdmin);
  const reps = users.filter((u) => u.role !== "CLIENT" && u.isActive);
  const [form, setForm] = useState<FormState>(() => fromClient(client));
  const queryClient = useQueryClient();

  const set = (key: keyof FormState) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = useMutation({
    mutationFn: () =>
      api<Client>(client ? `/clients/${client.id}` : "/clients", {
        method: client ? "PATCH" : "POST",
        body: toPayload(form, isAdmin, client),
      }),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      onSaved(saved);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {save.error && <Notice>{save.error.message}</Notice>}
      <Card className="grid gap-3 sm:grid-cols-2">
        <h2 className="font-bold sm:col-span-2">{t("clientDetails")}</h2>
        <Input label={t("clientName")} value={form.name} onChange={set("name")} required className="sm:col-span-2" />
        <Input label={t("code")} value={form.code} onChange={set("code")} dir="ltr" />
        <Select label={t("status")} value={form.status} onChange={set("status")}>
          <option value="ACTIVE">{t("status.ACTIVE")}</option>
          <option value="PROSPECT">{t("status.PROSPECT")}</option>
          <option value="INACTIVE">{t("status.INACTIVE")}</option>
        </Select>
        <Input label={t("city")} value={form.city} onChange={set("city")} />
        <Input label={t("address")} value={form.address} onChange={set("address")} />
        <Input label={t("crNumber")} value={form.crNumber} onChange={set("crNumber")} dir="ltr" inputMode="numeric" />
        <Input label={t("vatNumber")} value={form.vatNumber} onChange={set("vatNumber")} dir="ltr" inputMode="numeric" />
      </Card>

      <Card className="grid gap-3 sm:grid-cols-3">
        <h2 className="font-bold sm:col-span-3">{t("purchasing")}</h2>
        <Input label={t("purchasingName")} value={form.purchasingName} onChange={set("purchasingName")} />
        <Input label={t("purchasingPhone")} value={form.purchasingPhone} onChange={set("purchasingPhone")} dir="ltr" inputMode="tel" />
        <Input label={t("purchasingEmail")} value={form.purchasingEmail} onChange={set("purchasingEmail")} dir="ltr" type="email" />
      </Card>

      <Card className="grid gap-3 sm:grid-cols-3">
        <h2 className="font-bold sm:col-span-3">
          {t("creditTerms")} {!isAdmin && <span className="text-xs font-normal text-muted">({t("adminOnly")})</span>}
        </h2>
        <Input label={t("creditLimit")} value={form.creditLimit} onChange={set("creditLimit")} type="number" min={0} step="0.01" disabled={!isAdmin} dir="ltr" />
        <Select label={t("paymentTerms")} value={form.paymentTermsDays} onChange={set("paymentTermsDays")} disabled={!isAdmin}>
          <option value="0">{t("cash")}</option>
          {[30, 45, 60, 90].map((d) => (
            <option key={d} value={d}>{`${d} ${t("days")}`}</option>
          ))}
        </Select>
        <Input label={t("openingBalance")} value={form.openingBalance} onChange={set("openingBalance")} type="number" step="0.01" disabled={!isAdmin} dir="ltr" />
        {isAdmin && client && (
          <Select label={t("rep")} value={form.repId} onChange={set("repId")} className="sm:col-span-3">
            {reps.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </Select>
        )}
      </Card>

      <Card>
        <Textarea label={t("notes")} value={form.notes} onChange={set("notes")} />
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
