"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { api } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { useI18n, type MessageKey } from "@/lib/i18n";
import type { Role } from "@/lib/types";
import { BoxIcon, HomeIcon, LogoutIcon, OrdersIcon, PersonIcon, ShieldIcon, UsersIcon } from "./icons";
import { Muted } from "./ui";

type NavItem = {
  href: string;
  label: MessageKey;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  roles: Role[];
  /** Hidden from the phone's bottom bar (still in the desktop sidebar) to keep it to five items. */
  desktopOnly?: boolean;
};

const NAV: NavItem[] = [
  { href: "/", label: "home", icon: HomeIcon, roles: ["ADMIN", "REP"] },
  { href: "/orders", label: "orders", icon: OrdersIcon, roles: ["ADMIN", "REP"] },
  { href: "/clients", label: "clients", icon: UsersIcon, roles: ["ADMIN", "REP"] },
  { href: "/products", label: "products", icon: BoxIcon, roles: ["ADMIN", "REP"] },
  { href: "/users", label: "users", icon: ShieldIcon, roles: ["ADMIN"], desktopOnly: true },
  { href: "/profile", label: "profile", icon: PersonIcon, roles: ["ADMIN", "REP", "CLIENT"] },
];

const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

export function AppShell({ children }: { children: ReactNode }) {
  const { t, locale, setLocale } = useI18n();
  const pathname = usePathname();
  const { data: me, isLoading } = useMe();
  const items = NAV.filter((i) => me && i.roles.includes(me.role));
  const mobileItems = items.filter((i) => !i.desktopOnly);

  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col bg-brand-900 p-4 text-white md:flex">
        <div className="mb-6 px-2">
          <div className="text-lg font-bold">{t("appName")}</div>
          {me && <div className="text-xs text-white/70">{me.name}</div>}
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {items.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm",
                isActive(pathname, href) ? "bg-white/15 font-semibold" : "text-white/85 hover:bg-white/10",
              )}
            >
              <Icon width={20} height={20} />
              {t(label)}
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-1 border-t border-white/15 pt-3">
          <button
            onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
            className="min-h-11 rounded-xl px-3 text-start text-sm text-white/85 hover:bg-white/10"
          >
            {locale === "ar" ? "English" : "العربية"}
          </button>
          <button
            onClick={logout}
            className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-white/85 hover:bg-white/10"
          >
            <LogoutIcon width={20} height={20} />
            {t("logout")}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between bg-brand-900 px-4 py-3 text-white md:hidden">
          <span className="font-bold">{t("appName")}</span>
          <button onClick={() => setLocale(locale === "ar" ? "en" : "ar")} className="min-h-11 px-2 text-sm">
            {locale === "ar" ? "EN" : "ع"}
          </button>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 pb-24 md:p-6">
          {isLoading ? <Muted>{t("loading")}</Muted> : children}
        </main>
        <nav
          className="fixed inset-x-0 bottom-0 z-10 grid border-t border-line bg-white md:hidden"
          style={{ gridTemplateColumns: `repeat(${Math.max(mobileItems.length, 1)}, minmax(0, 1fr))` }}
        >
          {mobileItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex min-h-16 flex-col items-center justify-center gap-0.5 text-[11px]",
                isActive(pathname, href) ? "font-semibold text-brand-700" : "text-muted",
              )}
            >
              <Icon />
              {t(label)}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
