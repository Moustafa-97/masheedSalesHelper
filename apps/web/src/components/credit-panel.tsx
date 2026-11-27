"use client";

import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useCredit } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { formatMoney, uploadFile } from "@/lib/orders";
import type { AgingBucket } from "@/lib/types";
import { Stat } from "./order-bits";
import { Badge, Button, Card, Input, Notice } from "./ui";

/** Keeps numbers and dates in their own direction inside Arabic text. */
export const isolate = (s: string | number) => `⁨${s}⁩`;

const BUCKETS: AgingBucket[] = ["current", "d1_30", "d31_60", "d61_90", "d90plus"];
const BUCKET_TONE: Record<AgingBucket, string> = {
  current: "bg-brand-50 text-brand-800",
  d1_30: "bg-warn-bg text-warn",
  d31_60: "bg-warn-bg text-warn",
  d61_90: "bg-danger-bg text-danger",
  d90plus: "bg-danger-bg text-danger",
};

export function UsageBar({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const width = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex items-center gap-2">
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-canvas" aria-label={`${pct}%`}>
        <div
          className={clsx("h-full rounded-full", pct >= 90 ? "bg-danger" : pct >= 75 ? "bg-warn" : "bg-ok")}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className={clsx("w-12 text-end text-xs font-bold", pct >= 90 ? "text-danger" : pct >= 75 ? "text-warn" : "text-ok")}>
        {pct}%
      </span>
    </div>
  );
}

/** Account, limit use, aging, collection days and guarantee coverage for one client. */
export function CreditPanel({ clientId }: { clientId: string }) {
  const { t } = useI18n();
  const { data } = useCredit(clientId);
  if (!data) return null;
  const { account: a, profile: p } = data;
  const owed = BUCKETS.reduce((s, b) => s + p.aging[b], 0);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">{t("account")}</h2>
        <Link href={`/clients/${clientId}/statement`}>
          <Button variant="secondary" className="min-h-9">{t("statement")}</Button>
        </Link>
      </div>

      {p.overdueStop && (
        <Notice>
          {t("overdueStopped", {
            amount: isolate(formatMoney(p.overdue)),
            n: p.maxDaysOverdue,
            stop: p.overdueStopDays,
          })}
        </Notice>
      )}
      {p.awaitingReplacement > 0 && <Notice>{t("awaitingReplacementHint")}</Notice>}

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("ordersTotal")}>{formatMoney(a.ordersTotal)}</Stat>
        <Stat label={t("paid")}>{formatMoney(a.paid)}</Stat>
        <Stat label={t("balance")}>{formatMoney(a.balance)}</Stat>
        <Stat label={t("available")} strong>
          <span className={a.available < 0 ? "text-danger" : undefined}>{formatMoney(a.available)}</span>
        </Stat>
      </dl>
      {a.creditLimit > 0 && (
        <div>
          <div className="mb-1 text-xs text-muted">
            {t("creditUse")} · {t("creditLimit")} <bdi>{formatMoney(a.creditLimit)}</bdi>
          </div>
          <UsageBar pct={a.usagePct} />
        </div>
      )}
      {(a.pending > 0 || a.guarantees > 0 || a.approvedCredit > 0) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          {a.pending > 0 && <span>{t("pendingCollection")}: <bdi className="font-semibold text-ink">{formatMoney(a.pending)}</bdi></span>}
          {a.guarantees > 0 && <span>{t("guaranteesHeld")}: <bdi className="font-semibold text-ink">{formatMoney(a.guarantees)}</bdi></span>}
          {a.approvedCredit > 0 && <span>{t("approvedCredit")}: <bdi className="font-semibold text-ok">+{formatMoney(a.approvedCredit)}</bdi></span>}
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <h3 className="text-sm font-bold">{t("aging")}</h3>
        <div className="grid grid-cols-5 gap-1 text-center">
          {BUCKETS.map((b) => (
            <div key={b} className={clsx("rounded-lg px-1 py-2", p.aging[b] > 0 ? BUCKET_TONE[b] : "bg-canvas text-muted")}>
              <div className="text-[11px] leading-tight">{t(`aging.${b}`)}</div>
              <bdi className="text-xs font-bold">{formatMoney(p.aging[b]).replace(/\.00$/, "")}</bdi>
              {owed > 0 && <div className="text-[10px] opacity-70">{Math.round((p.aging[b] / owed) * 100)}%</div>}
            </div>
          ))}
        </div>
        {p.items.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-brand-700">
              {t("unpaidItems")} ({p.items.length})
            </summary>
            <ul className="mt-2 divide-y divide-line text-sm">
              {p.items.map((it) => (
                <li key={`${it.type}-${it.id}`} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span>
                    {it.type === "OPENING" ? (
                      t("openingBalanceItem")
                    ) : (
                      <Link href={`/orders/${it.id}`} className="text-brand-700 underline"><bdi>{it.reference}</bdi></Link>
                    )}
                    <span className="text-xs text-muted"> · <bdi>{it.date}</bdi></span>
                  </span>
                  <span className="flex items-center gap-2">
                    <bdi className="font-semibold">{formatMoney(it.outstanding)}</bdi>
                    {it.daysOverdue > 0 ? (
                      <Badge tone={it.daysOverdue > 60 ? "danger" : "warn"}>{t("daysLate", { n: it.daysOverdue })}</Badge>
                    ) : (
                      <span className="text-xs text-muted">{t("notDueYet", { date: isolate(it.dueDate) })}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-3 border-t border-line pt-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted">{t("avgCollectionDays")}</dt>
          <dd className="font-semibold">
            {p.avgCollectionDays === null ? (
              <span className="text-sm font-normal text-muted">{t("noPaidOrders")}</span>
            ) : (
              <span className={p.avgCollectionDays > a.paymentTermsDays ? "text-warn" : "text-ok"}>
                {t("avgVsTerms", { n: p.avgCollectionDays, terms: a.paymentTermsDays })}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t("coverage")}</dt>
          <dd className="font-semibold">
            {p.coveragePct === null ? "—" : (
              <span className={p.coveragePct >= 100 ? "text-ok" : p.coveragePct >= 50 ? "text-warn" : "text-danger"}>
                {t("coverageOfLimit", { n: p.coveragePct })}
              </span>
            )}
            {p.noGuaranteeApproval && (
              <div className="text-xs font-normal text-muted">{t("noGuaranteeBy", { name: p.noGuaranteeApproval.approvedBy ?? "" })}</div>
            )}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

/** Approve (or change) the credit a held cheque / LC adds: 100% of it unless stated. */
export function ApprovalForm({
  url,
  amount: max,
  current,
  approvedBy: currentBy,
  onSaved,
  onCancel,
}: {
  url: string;
  amount: number;
  current: number | null;
  approvedBy: string | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [amount, setAmount] = useState(String(current ?? max));
  const [approvedBy, setApprovedBy] = useState(currentBy ?? "");
  const [file, setFile] = useState<File | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const fileId = file ? (await uploadFile(file)).id : undefined;
      return api(url, { method: "PUT", body: { amount: Number(amount), approvedBy, fileId } });
    },
    onSuccess: onSaved,
  });
  return (
    <div role="group" className="grid grid-cols-2 gap-2 rounded-xl bg-canvas p-3">
      <Input label={t("approvedAmount")} value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="any" min={0} max={max} dir="ltr" />
      <Input label={t("approvedBy")} value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} />
      <label className="col-span-2 flex flex-col gap-1 text-xs text-muted">
        {t("approvalProof")}
        <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm text-ink" />
      </label>
      {save.error && <div className="col-span-2"><Notice>{save.error.message}</Notice></div>}
      <div className="col-span-2 flex gap-2">
        <Button type="button" onClick={() => save.mutate()} disabled={save.isPending || !approvedBy.trim()}>{t("save")}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>{t("cancel")}</Button>
      </div>
    </div>
  );
}
