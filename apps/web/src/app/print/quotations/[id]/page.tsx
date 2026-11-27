"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";
import { useQuotation } from "@/lib/hooks";
import { formatQty } from "@/lib/orders";
import { COMPANY, defaultPdfName, money2, printDate, UNIT_EN } from "@/lib/quotation";

const ORANGE = "#ed7d31";

/** 966557229540 -> +966 55 722 9540 */
const saPhone = (p: string) => {
  const d = p.replace(/\D/g, "");
  return /^9665\d{8}$/.test(d) ? `+966 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : p;
};
const PEACH = "#fbe4d5";

/**
 * The quotation as an A4 page, laid out like Masheed's template. It opens the print window;
 * "Save as PDF" names the file after the page title (the quotation's PDF name).
 */
export default function PrintQuotation() {
  const { id } = useParams<{ id: string }>();
  const { data: q } = useQuotation(id);

  useEffect(() => {
    if (!q) return;
    document.title = q.pdfName || defaultPdfName(q.date);
    // Wait for the logos and the font before opening the print window.
    const go = () => setTimeout(() => window.print(), 300);
    if (document.readyState === "complete") go();
    else window.addEventListener("load", go, { once: true });
  }, [q]);

  if (!q) return null;
  const units = [...new Set(q.lines.map((l) => l.unit))];
  const oneUnit = units.length === 1 ? UNIT_EN[units[0]] : null;
  const vat = 1 + q.vatRate / 100;
  const salesman = q.createdBy;

  const cell = "border px-2 py-1";
  const info: [string, string | null, string, string | null][] = [
    ["Customer", q.client.name, "Date:", printDate(q.date)],
    ["Reference", q.reference, "Our Ref.", q.number],
    ["Attn.", q.attn, "Salesman name:", salesman.name],
    ["Tel/Fax.", q.phone, "Tel.", salesman.phone ? saPhone(salesman.phone) : null],
    ["Email", q.email, "Email", salesman.email],
  ];

  return (
    <div dir="ltr" className="quote-root bg-neutral-200 print:bg-white">
      <style>{`
        @page { size: A4; margin: 0; }
        @media print { .no-print { display: none !important; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        .quote-page { font-family: Calibri, "Segoe UI", "IBM Plex Sans Arabic", sans-serif; }
      `}</style>

      <div className="no-print sticky top-0 z-10 flex items-center justify-center gap-3 bg-brand-900 p-3 text-sm text-white">
        <span dir="rtl">في نافذة الطباعة اختار &quot;حفظ كـ PDF&quot;</span>
        <button onClick={() => window.print()} className="rounded-lg bg-accent-500 px-4 py-2 font-bold text-ink">
          Save as PDF
        </button>
      </div>

      <div className="quote-page relative mx-auto flex min-h-[297mm] w-[210mm] flex-col bg-white px-[18mm] pb-[12mm] pt-[10mm] text-[11pt] text-black shadow print:shadow-none">
        <header className="flex items-end justify-between">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/masheed.png" alt="Masheed" className="h-[17mm]" />
          <div dir="rtl" className="pb-2 text-[15pt]">{COMPANY.nameAr}</div>
        </header>

        <h1 className="my-[8mm] text-center text-[22pt] font-bold tracking-wide">QUOTATION</h1>

        <table className="w-full border-collapse text-[9.5pt]" style={{ borderColor: ORANGE }}>
          <tbody>
            {info.map(([l1, v1, l2, v2], i) => (
              <tr key={l1} style={{ background: i % 2 === 0 ? PEACH : "white" }}>
                <th className={`${cell} w-[13%] text-right font-bold`} style={{ borderColor: ORANGE }}>{l1}</th>
                <td className={`${cell} w-[37%] font-semibold`} style={{ borderColor: ORANGE }}>{v1 ?? ""}</td>
                <th className={`${cell} w-[13%] text-right font-bold`} style={{ borderColor: ORANGE }}>{l2}</th>
                <td className={`${cell} w-[37%] font-semibold ${l2 === "Tel." ? "italic" : ""}`} style={{ borderColor: ORANGE }}>{v2 ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="my-[5mm]">With reference to your inquiry, we are pleased to quote our best price for the following:</p>

        <table className="w-full border-collapse text-center text-[9.5pt]">
          <thead>
            <tr className="text-white" style={{ background: ORANGE }}>
              {["No.", "ITEM", "UNIT price EX. VAT", `QUANTITY${oneUnit ? ` (${oneUnit})` : ""}`, "Unit Price Inc. VAT.", "Total Price EX. VAT", "Total Price INC. VAT"].map(
                (h) => (
                  <th key={h} className="border border-white px-1 py-2 font-bold">{h}</th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {q.lines.map((l, i) => (
              <tr key={l.id} className="border-b" style={{ borderColor: ORANGE }}>
                <td className="px-1 py-1">{i + 1}</td>
                <td className="px-1 py-1" dir="auto">{l.name}</td>
                <td className="px-1 py-1">{money2(l.unitPrice)}</td>
                <td className="px-1 py-1">{formatQty(l.qty)}{oneUnit ? "" : ` ${UNIT_EN[l.unit]}`}</td>
                <td className="px-1 py-1">{money2(l.unitPrice * vat)}</td>
                <td className="px-1 py-1">{money2(l.qty * l.unitPrice)}</td>
                <td className="px-1 py-1">{money2(l.qty * l.unitPrice * vat)}</td>
              </tr>
            ))}
            <tr className="border font-bold" style={{ borderColor: ORANGE }}>
              <td className="px-2 py-1 text-left" colSpan={5}>Total</td>
              <td className="px-1 py-1">{money2(q.totals.subtotal)}</td>
              <td className="px-1 py-1">{money2(q.totals.total)}</td>
            </tr>
          </tbody>
        </table>

        <section className="mt-[8mm]">
          <h2 className="text-[13pt] font-bold">Terms And conditions:</h2>
          {q.terms.split("\n").filter(Boolean).map((line, i) => (
            <p key={i} className={i === 0 ? "font-bold" : "mt-[2mm]"}>{line}</p>
          ))}
        </section>

        <section className="mt-[6mm]">
          <h2 className="text-[13pt] font-bold">Prepared By:</h2>
          <p className="mt-[3mm] text-[13pt] font-bold">{salesman.name}</p>
          {salesman.jobTitle && <p className="text-[9pt] font-semibold text-neutral-400">{salesman.jobTitle}</p>}
        </section>

        <footer className="mt-auto flex items-end justify-between pt-[10mm]">
          <div className="border-l-4 pl-3 text-[9pt] leading-snug" style={{ borderColor: ORANGE }}>
            {COMPANY.footer.map((f) => <div key={f}>{f}</div>)}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/alturki.png" alt="Alturki" className="h-[12mm]" />
        </footer>
      </div>
    </div>
  );
}
