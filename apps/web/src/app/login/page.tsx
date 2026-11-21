"use client";

import { useState, type FormEvent } from "react";
import { Button, Input, Notice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { User } from "@/lib/types";

export default function LoginPage() {
  const { t, locale, setLocale } = useI18n();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await api<User>("/auth/login", { method: "POST", body: { identifier, password } });
      if (user.locale !== locale) document.cookie = `locale=${user.locale}; path=/; max-age=31536000; samesite=lax`;
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t("invalidLogin") : t("error"));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-brand-900 p-4">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-white p-6 shadow-lg">
        <div>
          <h1 className="text-xl font-bold text-brand-900">{t("appName")}</h1>
          <p className="text-sm text-muted">{t("login")}</p>
        </div>
        {error && <Notice>{error}</Notice>}
        <Input
          label={t("identifier")}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          autoComplete="username"
          inputMode="email"
          dir="ltr"
          required
        />
        <Input
          label={t("password")}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          dir="ltr"
          required
        />
        <Button type="submit" disabled={busy}>
          {busy ? t("loading") : t("login")}
        </Button>
        <button
          type="button"
          onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
          className="min-h-11 text-sm text-brand-700"
        >
          {locale === "ar" ? "English" : "العربية"}
        </button>
      </form>
    </div>
  );
}
