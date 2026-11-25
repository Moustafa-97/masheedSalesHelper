"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Stat } from "@/components/order-bits";
import { Button, Card, Input, Muted, PageHeader } from "@/components/ui";
import { useStatement } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { formatMoney } from "@/lib/orders";
import type { GuaranteeType, PaymentMethod } from "@/lib/types";

const query = (from: string, to: string) => {
  const q = new URLSearchParams(Object.entries({ from, to }).filter(([, v]) => v)).toString();
  return q ? `?${q}` : "";
};

export default function StatementPage() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { data: st, isLoading } = useStatement(id, from || undefined, to || undefined);

  const methodName = (d: string) =>
    d
      .split(" · ")
      .map((x) => (["TRANSFER", "CASH", "CHEQUE", "LC"].includes(x) ? t(`method.${x as "CASH"}`) : x))
      .join(" · ");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("statement")}
        subtitle={st ? `${st.client.name}${st.client.code ? ` · ${st.client.code}` : ""}` : undefined}
        actions={
          <div className="flex gap-2 print:hidden">
            <a href={`/api/clients/${id}/statement/export${query(from, to)}`} download>
              <Button variant="secondary">{t("exportExcel")}</Button>
            </a>
            <Button variant="secondary" onClick={() => window.print()}>{t("print")}</Button>
          </div>
        }
      />

      <Card className="grid grid-cols-2 gap-2 print:hidden md:grid-cols-4">
        <Input label={t("from")} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label={t("to")} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <div className="col-span-2 flex items-end">
          <Link href={`/clients/${id}`} className="text-sm text-brand-700 underline">← {st?.client.name}</Link>
        </div>
      </Card>
      <p className="hidden text-sm print:block">
        {t("from")} {from || t("fromStart")} {t("to")} {to || new Date().toISOString().slice(0, 10)}
      </p>

      {isLoading && <Muted>{t("loading")}</Muted>}
      {st && (
        <>
          <Card className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t("openingBalanceRow")}>{formatMoney(st.opening)}</Stat>
            <Stat label={t("debit")}>{formatMoney(st.totalDebit)}</Stat>
            <Stat label={t("credit")}>{formatMoney(st.totalCredit)}</Stat>
            <Stat label={t("closingBalance")} strong>{formatMoney(st.closing)}</Stat>
          </Card>

          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-brand-900 text-white">
                <tr>
                  {["date", "type", "reference", "particulars", "debit", "credit", "runningBalance"].map((k) => (
                    <th key={k} className="px-3 py-2 text-start font-semibold">
                      {t(k as "debit")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <tr className="bg-canvas italic">
                  <td className="px-3 py-2"><bdi>{st.from ?? ""}</bdi></td>
                  <td className="px-3 py-2" colSpan={5}>{t("openingBalanceRow")}</td>
                  <td className="px-3 py-2 font-semibold"><bdi>{formatMoney(st.opening)}</bdi></td>
                </tr>
                {!st.entries.length && (
                  <tr><td colSpan={7} className="px-3 py-4 text-center text-muted">{t("noEntries")}</td></tr>
                )}
                {st.entries.map((e) => (
                  <tr key={`${e.type}-${e.id}`}>
                    <td className="whitespace-nowrap px-3 py-2"><bdi>{e.date}</bdi></td>
                    <td className="px-3 py-2">{t(`entryType.${e.type}`)}</td>
                    <td className="px-3 py-2">
                      {e.type === "ORDER" ? (
                        <Link href={`/orders/${e.id}`} className="text-brand-700 underline"><bdi>{e.reference}</bdi></Link>
                      ) : (
                        <bdi>{e.reference}</bdi>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted">{e.type === "PAYMENT" ? methodName(e.description) : e.description}</td>
                    <td className="px-3 py-2"><bdi>{e.debit ? formatMoney(e.debit) : ""}</bdi></td>
                    <td className="px-3 py-2"><bdi>{e.credit ? formatMoney(e.credit) : ""}</bdi></td>
                    <td className="px-3 py-2 font-semibold"><bdi>{formatMoney(e.balance)}</bdi></td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-ink font-bold">
                <tr>
                  <td className="px-3 py-2" colSpan={4}>{t("total")}</td>
                  <td className="px-3 py-2"><bdi>{formatMoney(st.totalDebit)}</bdi></td>
                  <td className="px-3 py-2"><bdi>{formatMoney(st.totalCredit)}</bdi></td>
                  <td className="px-3 py-2"><bdi>{formatMoney(st.closing)}</bdi></td>
                </tr>
              </tfoot>
            </table>
          </Card>

          {[
            { list: st.pending, title: t("pendingNotCounted"), dateLabel: t("chequeDueDate"), guarantee: false },
            { list: st.guarantees, title: t("guarantees"), dateLabel: t("expiryDate"), guarantee: true },
          ]
            .filter((g) => g.list.length > 0)
            .map((g) => (
              <Card key={g.title} className="flex flex-col gap-2">
                <h2 className="font-bold">{g.title}</h2>
                <ul className="flex flex-col gap-1 text-sm">
                  {g.list.map((p) => (
                    <li key={p.id}>
                      {p.amount !== null && <><bdi className="font-semibold">{formatMoney(p.amount)}</bdi> · </>}
                      {g.guarantee ? t(`gType.${p.method as GuaranteeType}`) : t(`method.${p.method as PaymentMethod}`)}
                      {p.bank && ` · ${p.bank}`}
                      {p.reference && <> · <bdi>{p.reference}</bdi></>}
                      {p.dueDate && <> · {g.dateLabel} <bdi>{p.dueDate}</bdi></>}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
        </>
      )}
    </div>
  );
}
