"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useMe } from "@/lib/hooks";
import { useI18n, type MessageKey } from "@/lib/i18n";

const TABS: { href: string; label: MessageKey; admin?: boolean }[] = [
  { href: "/market", label: "marketAnalysis" },
  { href: "/market/lost", label: "lostDeals" },
  { href: "/market/prices", label: "marketPrices" },
  { href: "/market/competitors", label: "competitors", admin: true },
];

export default function MarketLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const { data: me } = useMe();
  const active = (href: string) => (href === "/market" ? pathname === href : pathname.startsWith(href));
  return (
    <div className="flex flex-col gap-4">
      <nav role="tablist" className="flex gap-1 overflow-x-auto rounded-xl bg-white p-1 shadow-sm">
        {TABS.filter((tab) => !tab.admin || me?.role === "ADMIN").map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={active(tab.href)}
            className={clsx(
              "flex min-h-10 flex-1 items-center justify-center whitespace-nowrap rounded-lg px-3 text-sm font-semibold",
              active(tab.href) ? "bg-brand-700 text-white" : "text-muted hover:bg-brand-50",
            )}
          >
            {t(tab.label)}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
