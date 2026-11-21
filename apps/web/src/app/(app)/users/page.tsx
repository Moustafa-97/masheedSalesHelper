"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Badge, Button, Card, Input, Muted, Notice, PageHeader, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useClients, useMe, useUsers } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import type { Role, User } from "@/lib/types";

function NewUserForm() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data: clients = [] } = useClients();
  const empty = { name: "", email: "", phone: "", password: "", role: "REP" as Role, jobTitle: "", clientId: "" };
  const [f, setF] = useState(empty);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () =>
      api<User>("/users", {
        method: "POST",
        body: Object.fromEntries(
          Object.entries({ ...f, clientId: f.role === "CLIENT" ? f.clientId : "" }).filter(([, v]) => v !== ""),
        ),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setF(empty);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <h2 className="font-bold">{t("newUser")}</h2>
      {save.error && <Notice>{save.error.message}</Notice>}
      <Input label={t("name")} value={f.name} onChange={set("name")} required />
      <Input label={t("email")} value={f.email} onChange={set("email")} type="email" dir="ltr" />
      <Input label={t("phone")} value={f.phone} onChange={set("phone")} dir="ltr" inputMode="tel" />
      <Select label={t("role")} value={f.role} onChange={set("role")}>
        {(["REP", "ADMIN", "CLIENT"] as Role[]).map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
      </Select>
      {f.role === "CLIENT" ? (
        <Select label={t("linkedClient")} value={f.clientId} onChange={set("clientId")} required>
          <option value="">—</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      ) : (
        <Input label={t("jobTitle")} value={f.jobTitle} onChange={set("jobTitle")} />
      )}
      <Input label={t("password")} hint={t("passwordMin")} value={f.password} onChange={set("password")} type="password" minLength={8} dir="ltr" required autoComplete="new-password" />
      <Button type="submit" disabled={save.isPending}>{t("add")}</Button>
    </form>
  );
}

function UserRow({ u, self }: { u: User; self: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState("");
  const toggle = useMutation({
    mutationFn: () => api(`/users/${u.id}`, { method: "PATCH", body: { isActive: !u.isActive } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
  const reset = useMutation({
    mutationFn: () => api(`/users/${u.id}/reset-password`, { method: "POST", body: { password } }),
    onSuccess: () => (setResetting(false), setPassword("")),
  });

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold">{u.name}</div>
          <div className="text-xs text-muted" dir="ltr">{[u.email, u.phone].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={u.role === "ADMIN" ? "info" : u.role === "CLIENT" ? "warn" : "neutral"}>{t(`role.${u.role}`)}</Badge>
          {!u.isActive && <Badge tone="danger">{t("inactive")}</Badge>}
          <Button variant="ghost" onClick={() => setResetting((r) => !r)}>{t("resetPassword")}</Button>
          {!self && (
            <Button variant="ghost" onClick={() => toggle.mutate()} disabled={toggle.isPending}>
              {u.isActive ? t("deactivate") : t("activate")}
            </Button>
          )}
        </div>
      </div>
      {resetting && (
        <form
          onSubmit={(e) => (e.preventDefault(), reset.mutate())}
          className="flex flex-wrap items-end gap-2"
        >
          <Input label={t("newPassword")} hint={t("passwordMin")} value={password} onChange={(e) => setPassword(e.target.value)} type="password" minLength={8} dir="ltr" required autoComplete="new-password" />
          <Button type="submit" disabled={reset.isPending}>{t("save")}</Button>
          {reset.error && <Notice>{reset.error.message}</Notice>}
        </form>
      )}
    </li>
  );
}

export default function UsersPage() {
  const { t } = useI18n();
  const { data: me } = useMe();
  const { data: users, isLoading } = useUsers(me?.role === "ADMIN");
  if (me && me.role !== "ADMIN") return <Muted>{t("adminOnly")}</Muted>;

  return (
    <>
      <PageHeader title={t("users")} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="p-0">
          {isLoading && <Muted>{t("loading")}</Muted>}
          <ul className="divide-y divide-line">
            {users?.map((u) => <UserRow key={u.id} u={u} self={u.id === me?.id} />)}
          </ul>
        </Card>
        <Card><NewUserForm /></Card>
      </div>
    </>
  );
}
