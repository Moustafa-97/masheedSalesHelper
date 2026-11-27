"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useGuarantees, usePayments } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { fileUrl, formatMoney, today, uploadFile } from "@/lib/orders";
import type { Guarantee, GuaranteeType } from "@/lib/types";
import { ApprovalForm, isolate } from "./credit-panel";
import { ReasonAction } from "./order-bits";
import { Badge, Button, Card, Input, Notice, Select, Textarea } from "./ui";

const TYPES: GuaranteeType[] = ["EPN", "CHEQUE", "LC", "LG", "NO_GUARANTEE"];
const ADDS_CREDIT: GuaranteeType[] = ["CHEQUE", "LC"];

function useRefresh(clientId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["guarantees", clientId] });
    qc.invalidateQueries({ queryKey: ["account", clientId] });
    qc.invalidateQueries({ queryKey: ["payments", clientId] });
    qc.invalidateQueries({ queryKey: ["statement", clientId] });
    qc.invalidateQueries({ queryKey: ["orders", "summary"] });
  };
}

/** Link the transfer or LC that replaced a bounced guarantee cheque. */
function Replacement({ clientId, g }: { clientId: string; g: Guarantee }) {
  const { t } = useI18n();
  const refresh = useRefresh(clientId);
  const { data: payments = [] } = usePayments(clientId);
  const [paymentId, setPaymentId] = useState("");
  const options = payments.filter((p) => !p.removedAt && p.status !== "BOUNCED" && p.method !== "CHEQUE");
  const save = useMutation({
    mutationFn: () => api(`/clients/${clientId}/guarantees/${g.id}/replacement`, { method: "PUT", body: { paymentId } }),
    onSuccess: refresh,
  });
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-danger-bg p-3">
      <p className="text-sm font-semibold text-danger">{t("awaitingReplacementHint")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <Select label={t("chooseReplacement")} value={paymentId} onChange={(e) => setPaymentId(e.target.value)} className="min-w-56 flex-1">
          <option value="">—</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {`${t(`method.${p.method}`)} · ${formatMoney(p.amount)} · ${p.date}${p.reference ? ` · ${p.reference}` : ""}`}
            </option>
          ))}
        </Select>
        <Button type="button" onClick={() => save.mutate()} disabled={!paymentId || save.isPending}>{t("linkReplacement")}</Button>
      </div>
      <p className="text-xs text-muted">{t("addPayment")} ↓</p>
      {save.error && <Notice>{save.error.message}</Notice>}
    </div>
  );
}

function GuaranteeRow({ clientId, g }: { clientId: string; g: Guarantee }) {
  const { t } = useI18n();
  const refresh = useRefresh(clientId);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/clients/${clientId}/guarantees/${g.id}`;
  const run = (p: Promise<unknown>) => p.then(refresh).catch((e: Error) => setError(e.message));
  const held = g.status === "ACTIVE" && !g.removedAt;
  const off = !held && !g.awaitingReplacement;
  // 30 days from now, fixed for this render cycle.
  const [soon] = useState(() => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  const expiring = held && g.expiryDate && g.expiryDate <= soon;

  return (
    <li className={clsx("flex flex-col gap-2 rounded-xl border p-3 text-sm", g.awaitingReplacement ? "border-danger" : "border-line", off && "opacity-60")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={clsx(g.removedAt && "line-through")}>
          <span className="font-semibold">{t(`gType.${g.type}`)}</span>
          {g.amount !== null && <> · <bdi className="font-bold">{formatMoney(g.amount)}</bdi></>}
          {g.issuer && <> · {g.issuer}</>}
          {g.reference && <> · <bdi>{g.reference}</bdi></>}
        </div>
        <div className="flex gap-1">
          {g.awaitingReplacement && <Badge tone="danger">{t("awaitingReplacement")}</Badge>}
          {expiring && <Badge tone="warn">{t("fu.GUARANTEE_EXPIRING")}</Badge>}
          <Badge tone={held ? "ok" : g.status === "BOUNCED" ? "danger" : "neutral"}>{t(`gStatus.${g.status}`)}</Badge>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 text-xs text-muted">
        {g.date && <span>{g.type === "CHEQUE" ? t("chequeDate") : t("issueDate")}: <bdi>{g.date}</bdi></span>}
        {g.expiryDate && <span>{t("expiryDate")}: <bdi>{g.expiryDate}</bdi></span>}
        {g.file && <a href={fileUrl(g.file.id)} target="_blank" rel="noreferrer" className="text-brand-700 underline">{t("file")}</a>}
      </div>
      {g.approvedBy && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {g.creditApprovedAmount !== null && held && (
            <Badge tone="ok">{`${t("addsCredit")} +${isolate(formatMoney(g.creditApprovedAmount))}`}</Badge>
          )}
          <span className="text-muted">{t("approvedBy")}: {g.approvedBy} · <bdi>{g.approvedAt}</bdi></span>
          {g.approvalFile && (
            <a href={fileUrl(g.approvalFile.id)} target="_blank" rel="noreferrer" className="text-brand-700 underline">{t("approvalProof")}</a>
          )}
        </div>
      )}
      {g.notes && <p className="whitespace-pre-line text-xs text-muted">{g.notes}</p>}
      {g.removedAt && <Badge tone="danger">{t("removed")}: {g.removedReason}</Badge>}
      {g.awaitingReplacement && <Replacement clientId={clientId} g={g} />}
      {approving && (
        <ApprovalForm
          url={`${base}/approval`}
          amount={g.amount ?? 0}
          current={g.creditApprovedAmount}
          approvedBy={g.approvedBy}
          onSaved={() => (refresh(), setApproving(false))}
          onCancel={() => setApproving(false)}
        />
      )}
      {held && (
        <div className="flex flex-wrap gap-2">
          {ADDS_CREDIT.includes(g.type) && (
            <>
              {!approving && (
                <Button variant="ghost" className="min-h-9" onClick={() => setApproving(true)}>
                  {g.creditApprovedAmount !== null ? t("editApproval") : t("creditApproval")}
                </Button>
              )}
              <Button variant="secondary" className="min-h-9" onClick={() => run(api(`${base}/convert`, { method: "POST", body: {} }))}>
                {t("presentForCollection")}
              </Button>
            </>
          )}
          <ReasonAction label={t("markReturned")} onConfirm={(reason) => run(api(`${base}/status`, { method: "PUT", body: { status: "RETURNED", reason } }))} />
          {g.type === "CHEQUE" && (
            <ReasonAction label={t("markBounced")} onConfirm={(reason) => run(api(`${base}/status`, { method: "PUT", body: { status: "BOUNCED", reason } }))} />
          )}
          {g.expiryDate && (
            <Button variant="ghost" className="min-h-9" onClick={() => run(api(`${base}/status`, { method: "PUT", body: { status: "EXPIRED" } }))}>
              {t("markExpired")}
            </Button>
          )}
          <ReasonAction label={t("remove")} onConfirm={(reason) => run(api(base, { method: "DELETE", body: { reason } }))} />
        </div>
      )}
      {error && <Notice>{error}</Notice>}
    </li>
  );
}

function AddGuarantee({ clientId }: { clientId: string }) {
  const { t } = useI18n();
  const refresh = useRefresh(clientId);
  const { data: list = [] } = useGuarantees(clientId);
  const [type, setType] = useState<GuaranteeType>("EPN");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [issuer, setIssuer] = useState("");
  const [date, setDate] = useState(today());
  const [expiryDate, setExpiryDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [approve, setApprove] = useState(true);
  const [approved, setApproved] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [replaces, setReplaces] = useState("");
  const credit = ADDS_CREDIT.includes(type);
  const none = type === "NO_GUARANTEE";
  const bounced = list.filter((g) => g.awaitingReplacement);

  const save = useMutation({
    mutationFn: async () => {
      const fileId = file ? (await uploadFile(file)).id : null;
      return api(`/clients/${clientId}/guarantees`, {
        method: "POST",
        body: {
          type,
          amount: amount ? Number(amount) : null,
          reference: reference || null,
          issuer: issuer || null,
          date: none ? null : date || null,
          expiryDate: expiryDate || null,
          fileId,
          creditApprovedAmount: credit && approve ? Number(approved || amount) : null,
          approvedBy: (credit && approve) || none ? approvedBy : null,
          notes: notes || null,
          replacesGuaranteeId: replaces || null,
        },
      });
    },
    onSuccess: () => {
      setAmount("");
      setReference("");
      setApproved("");
      setNotes("");
      setFile(null);
      setReplaces("");
      refresh();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(undefined, { onSuccess: () => (e.target as HTMLFormElement).reset() });
  };

  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-brand-700">+ {t("addGuarantee")}</summary>
      <form onSubmit={submit} className="mt-3 grid grid-cols-2 gap-2">
        <Select label={t("type")} value={type} onChange={(e) => setType(e.target.value as GuaranteeType)} className="col-span-2">
          {TYPES.map((x) => <option key={x} value={x}>{t(`gType.${x}`)}</option>)}
        </Select>
        <Input label={t("amount")} hint={none ? t("optional") : undefined} value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="any" min={0.01} required={!none} dir="ltr" />
        {!none && <Input label={t("reference")} value={reference} onChange={(e) => setReference(e.target.value)} dir="ltr" />}
        {!none && <Input label={t("issuer")} value={issuer} onChange={(e) => setIssuer(e.target.value)} />}
        {!none && <Input label={type === "CHEQUE" ? t("chequeDate") : t("issueDate")} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
        {type !== "CHEQUE" && !none && (
          <Input label={t("expiryDate")} type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
        )}
        {!none && (
          <label className="col-span-2 flex flex-col gap-1 text-xs text-muted">
            {t("file")}
            <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm text-ink" />
          </label>
        )}
        {credit && (
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} className="size-4" />
            {t("creditApproval")} ({t("addsCredit")})
          </label>
        )}
        {credit && approve && (
          <Input label={t("approvedAmount")} value={approved} onChange={(e) => setApproved(e.target.value)} placeholder={amount || "100%"} type="number" step="any" min={0} dir="ltr" />
        )}
        {((credit && approve) || none) && (
          <Input label={t("approvedBy")} value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} required />
        )}
        {type === "CHEQUE" && <p className="col-span-2 text-xs text-muted">{t("guaranteeHint")}</p>}
        {bounced.length > 0 && !none && (
          <Select label={t("awaitingReplacement")} value={replaces} onChange={(e) => setReplaces(e.target.value)} className="col-span-2">
            <option value="">—</option>
            {bounced.map((g) => <option key={g.id} value={g.id}>{`${t(`gType.${g.type}`)} · ${formatMoney(g.amount)} · ${g.reference ?? ""}`}</option>)}
          </Select>
        )}
        <Textarea label={t("notes")} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="col-span-2" />
        {save.error && <div className="col-span-2"><Notice>{save.error.message}</Notice></div>}
        <div className="col-span-2"><Button type="submit" disabled={save.isPending}>{t("save")}</Button></div>
      </form>
    </details>
  );
}

export function Guarantees({ clientId }: { clientId: string }) {
  const { t } = useI18n();
  const { data: list = [] } = useGuarantees(clientId);
  const ordered = [...list].sort((a, b) => Number(b.awaitingReplacement) - Number(a.awaitingReplacement) || Number(a.status !== "ACTIVE") - Number(b.status !== "ACTIVE"));
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-bold">{t("guarantees")}</h2>
      {!list.length && <p className="text-sm text-muted">—</p>}
      <ul className="flex flex-col gap-2">
        {ordered.map((g) => <GuaranteeRow key={g.id} clientId={clientId} g={g} />)}
      </ul>
      <AddGuarantee clientId={clientId} />
    </Card>
  );
}
