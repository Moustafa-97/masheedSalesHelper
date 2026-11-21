"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button, Card, Input, Muted, Notice, PageHeader, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import type { Locale, User } from "@/lib/types";

function ProfileForm({ me }: { me: User }) {
  const { t, locale, setLocale } = useI18n();
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: me.name,
    email: me.email ?? "",
    phone: me.phone ?? "",
    jobTitle: me.jobTitle ?? "",
    locale: me.locale,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () =>
      api<User>("/auth/me", {
        method: "PATCH",
        body: Object.fromEntries(Object.entries(f).filter(([, v]) => v !== "")),
      }),
    onSuccess: (user) => {
      qc.setQueryData(["me"], user);
      if (user.locale !== locale) setLocale(user.locale);
    },
  });

  return (
    <form onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate())} className="flex flex-col gap-3">
      <div>
        <h2 className="font-bold">{t("profile")}</h2>
        <p className="text-xs text-muted">{t("quoteInfo")}</p>
      </div>
      {save.error && <Notice>{save.error.message}</Notice>}
      {save.isSuccess && <Notice tone="ok">{t("saved")}</Notice>}
      <Input label={t("name")} value={f.name} onChange={set("name")} required />
      <Input label={t("jobTitle")} value={f.jobTitle} onChange={set("jobTitle")} />
      <Input label={t("email")} value={f.email} onChange={set("email")} type="email" dir="ltr" />
      <Input label={t("phone")} value={f.phone} onChange={set("phone")} dir="ltr" inputMode="tel" />
      <Select label={t("language")} value={f.locale} onChange={(e) => setF((s) => ({ ...s, locale: e.target.value as Locale }))}>
        <option value="ar">العربية</option>
        <option value="en">English</option>
      </Select>
      <Button type="submit" disabled={save.isPending}>{save.isPending ? t("saving") : t("save")}</Button>
    </form>
  );
}

function PasswordForm() {
  const { t } = useI18n();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const save = useMutation({
    mutationFn: () => api("/auth/change-password", { method: "POST", body: { currentPassword, newPassword } }),
    onSuccess: () => (setCurrent(""), setNew("")),
  });
  return (
    <form onSubmit={(e: FormEvent) => (e.preventDefault(), save.mutate())} className="flex flex-col gap-3">
      <h2 className="font-bold">{t("changePassword")}</h2>
      {save.error && <Notice>{save.error.message}</Notice>}
      {save.isSuccess && <Notice tone="ok">{t("saved")}</Notice>}
      <Input label={t("currentPassword")} value={currentPassword} onChange={(e) => setCurrent(e.target.value)} type="password" dir="ltr" required autoComplete="current-password" />
      <Input label={t("newPassword")} hint={t("passwordMin")} value={newPassword} onChange={(e) => setNew(e.target.value)} type="password" minLength={8} dir="ltr" required autoComplete="new-password" />
      <Button type="submit" variant="secondary" disabled={save.isPending}>{t("save")}</Button>
    </form>
  );
}

export default function ProfilePage() {
  const { t } = useI18n();
  const { data: me } = useMe();
  if (!me) return <Muted>{t("loading")}</Muted>;
  return (
    <>
      <PageHeader title={t("profile")} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><ProfileForm me={me} /></Card>
        <Card><PasswordForm /></Card>
      </div>
    </>
  );
}
