import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { Locale } from "@/lib/types";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "متابعة المبيعات | Sales Tracker",
  description: "Orders, collections and credit tracking for sales reps",
};

export const viewport: Viewport = { themeColor: "#0b3d33" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale: Locale = (await cookies()).get("locale")?.value === "en" ? "en" : "ar";
  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} className="h-full antialiased">
      <body className="min-h-full font-sans">
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
