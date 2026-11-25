import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { Client } from '../clients/client.entity.js';
import { Role, User } from '../users/user.entity.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Days after a collection cheque's date during which its approval still counts (time to clear). */
export const APPROVAL_GRACE_DAYS = 3;
/** A guarantee cheque gets a reminder this many months after its date. */
export const GUARANTEE_REMINDER_MONTHS = 6;
/** A payment LC still being collected this many days after its date needs attention. */
export const LC_ATTENTION_DAYS = 20;
/** New orders stop when an amount is more than this many days past due (per client: overdueStopDays). */
export const DEFAULT_OVERDUE_STOP_DAYS = 30;

/** Approved collection cheques count until 3 days after their date. SQL on `payments`. */
export const CHEQUE_APPROVAL_UNTIL_SQL = `("dueDate" + INTERVAL '${APPROVAL_GRACE_DAYS} days')::date`;

/** Temporary credit from payments being collected: approved cheques (while valid) and payment LCs in full. */
const PAYMENT_CREDIT_SQL = `CASE
    WHEN method = 'CHEQUE' AND "creditApprovedAmount" > 0 AND CURRENT_DATE <= ${CHEQUE_APPROVAL_UNTIL_SQL} THEN "creditApprovedAmount"
    WHEN method = 'LC' THEN amount
    ELSE 0 END`;

export interface ClientAccount {
  creditLimit: number;
  openingBalance: number;
  /** All orders that aren't cancelled, incl. VAT, removed lines excluded. */
  ordersTotal: number;
  paid: number;
  /** Cheques and LCs being collected: not in the balance. */
  pending: number;
  /** Active guarantees of every kind (notes, LCs, LGs, cheques). */
  guarantees: number;
  /** Temporary credit: approved cheques and LCs (payments being collected, and guarantee cheques / LCs). */
  approvedCredit: number;
  /** What the client owes: opening balance + orders − payments. */
  balance: number;
  /** creditLimit − balance + approvedCredit: how much more can be ordered. */
  available: number;
  /** balance as a % of the limit (null when there is no limit). */
  usagePct: number | null;
  paymentTermsDays: number;
}

/** Totals of one order: subtotal and VAT are rounded to halalas separately, as on an invoice. */
export function orderTotals(lines: { qty: number; unitPrice: number; removedAt: Date | null }[], vatRate: number) {
  const subtotal = round2(lines.filter((l) => !l.removedAt).reduce((s, l) => s + l.qty * l.unitPrice, 0));
  const vat = round2((subtotal * vatRate) / 100);
  return { subtotal, vat, total: round2(subtotal + vat) };
}

/** "2026-11-23" + 30 days -> "2026-12-23" (dates without time zones). */
export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export const todayIso = () => new Date().toISOString().slice(0, 10);

/* ---------- Statement ---------- */

export interface StatementEntry {
  date: string;
  type: 'ORDER' | 'PAYMENT';
  id: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface StatementHeld {
  id: string;
  method: string;
  amount: number | null;
  date: string | null;
  dueDate: string | null;
  reference: string | null;
  bank: string | null;
}

export interface Statement {
  client: { id: string; name: string; code: string | null };
  from: string | null;
  to: string | null;
  /** Balance before `from` (the client's opening balance when there is no `from`). */
  opening: number;
  entries: StatementEntry[];
  totalDebit: number;
  totalCredit: number;
  closing: number;
  /** Cheques and LCs being collected (not in the balance). */
  pending: StatementHeld[];
  /** Active guarantees (not in the balance). */
  guarantees: StatementHeld[];
}

/* ---------- Aging ---------- */

export type AgingBucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90plus';

export interface AgingItem {
  type: 'OPENING' | 'ORDER';
  id: string | null;
  reference: string;
  date: string;
  dueDate: string;
  amount: number;
  outstanding: number;
  daysOverdue: number;
  bucket: AgingBucket;
}

export interface CreditProfile {
  aging: Record<AgingBucket, number>;
  /** Unpaid opening balance and orders, oldest first. */
  items: AgingItem[];
  overdue: number;
  maxDaysOverdue: number;
  /** Unpaid credit balance (payments beyond what is owed). */
  unapplied: number;
  /** Weighted average days from order date to full payment, over paid orders (null if none). */
  avgCollectionDays: number | null;
  paidOrders: number;
  /** Active guarantees as a % of the credit limit (null without a limit). */
  coveragePct: number | null;
  /** Credit approved with no guarantee, if any. */
  noGuaranteeApproval: { approvedBy: string | null; approvedAt: string | null; amount: number | null } | null;
  /** Bounced guarantee cheques still waiting for a replacement. */
  awaitingReplacement: number;
  overdueStopDays: number;
  /** True when new orders stop until the overdue amount is settled or the stop is bypassed. */
  overdueStop: boolean;
}

const bucketOf = (days: number): AgingBucket =>
  days <= 0 ? 'current' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90plus';

@Injectable()
export class AccountService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * The client, if this user may work with it: admins any client, reps their own.
   * Pass `lock` inside a transaction to serialise credit checks for the same client.
   */
  async clientFor(user: User, clientId: string, m: EntityManager = this.dataSource.manager, lock = false) {
    if (user.role !== Role.ADMIN && user.role !== Role.REP) throw new ForbiddenException();
    const qb = m.getRepository(Client).createQueryBuilder('c').where('c.id = :clientId', { clientId });
    if (user.role === Role.REP) qb.andWhere('c.repId = :repId', { repId: user.id });
    if (lock) qb.setLock('pessimistic_write');
    const client = await qb.getOne();
    if (!client) throw new NotFoundException('Client not found');
    return client;
  }

  /** Every non-cancelled order of the client with its total incl. VAT. */
  private orderTotalsOf(m: EntityManager, clientId: string) {
    return m.query(
      `SELECT o.id, o.number, to_char(o."orderDate", 'YYYY-MM-DD') AS date, p.name AS project,
              (ROUND(SUM(l.qty * l."unitPrice"), 2) + ROUND(ROUND(SUM(l.qty * l."unitPrice"), 2) * o."vatRate" / 100, 2))::float AS total
         FROM orders o
         JOIN order_lines l ON l."orderId" = o.id AND l."removedAt" IS NULL
         LEFT JOIN client_projects p ON p.id = o."projectId"
        WHERE o."clientId" = $1 AND o.status <> 'CANCELLED'
        GROUP BY o.id, p.name
        ORDER BY o."orderDate", o."createdAt"`,
      [clientId],
    ) as Promise<{ id: string; number: string; date: string; project: string | null; total: number }[]>;
  }

  /** Collected payments, oldest first, with the date they reached the account. */
  private collectedPayments(m: EntityManager, clientId: string) {
    return m.query(
      `SELECT id, method, amount::float AS amount, reference, bank,
              to_char(COALESCE("collectedDate", date), 'YYYY-MM-DD') AS date
         FROM payments
        WHERE "clientId" = $1 AND "removedAt" IS NULL AND status = 'RECEIVED'
        ORDER BY COALESCE("collectedDate", date), "createdAt"`,
      [clientId],
    ) as Promise<{ id: string; method: string; amount: number; reference: string | null; bank: string | null; date: string }[]>;
  }

  async account(client: Client, m: EntityManager = this.dataSource.manager): Promise<ClientAccount> {
    const orders = await this.orderTotalsOf(m, client.id);
    const [p] = await m.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'RECEIVED'), 0)::float AS paid,
              COALESCE(SUM(amount) FILTER (WHERE status = 'PENDING'), 0)::float AS pending,
              COALESCE(SUM(${PAYMENT_CREDIT_SQL}) FILTER (WHERE status = 'PENDING'), 0)::float AS credit
         FROM payments WHERE "clientId" = $1 AND "removedAt" IS NULL`,
      [client.id],
    );
    const [g] = await m.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE type <> 'NO_GUARANTEE'), 0)::float AS held,
              COALESCE(SUM("creditApprovedAmount") FILTER (WHERE type IN ('CHEQUE', 'LC')), 0)::float AS credit
         FROM client_guarantees WHERE "clientId" = $1 AND "removedAt" IS NULL AND status = 'ACTIVE'`,
      [client.id],
    );
    const ordersTotal = round2(orders.reduce((s, o) => s + o.total, 0));
    const paid = round2(p.paid);
    const balance = round2(client.openingBalance + ordersTotal - paid);
    const approvedCredit = round2(p.credit + g.credit);
    return {
      creditLimit: client.creditLimit,
      openingBalance: client.openingBalance,
      ordersTotal,
      paid,
      pending: round2(p.pending),
      guarantees: round2(g.held),
      approvedCredit,
      balance,
      available: round2(client.creditLimit - balance + approvedCredit),
      usagePct: client.creditLimit > 0 ? Math.round((balance / client.creditLimit) * 100) : null,
      paymentTermsDays: client.paymentTermsDays,
    };
  }

  /**
   * Applies collected payments to the opening balance and orders, oldest first, to tell what is
   * still unpaid and how late, and how long the client takes to pay. The opening balance is due
   * `paymentTermsDays` after the client was added.
   */
  async profile(client: Client, m: EntityManager = this.dataSource.manager, asOf = todayIso()): Promise<CreditProfile> {
    const [orders, payments] = await Promise.all([this.orderTotalsOf(m, client.id), this.collectedPayments(m, client.id)]);
    const openingDate = client.createdAt.toISOString().slice(0, 10);
    const debts = [
      ...(client.openingBalance > 0
        ? [{ type: 'OPENING' as const, id: null, reference: '', date: openingDate, amount: client.openingBalance }]
        : []),
      ...orders.map((o) => ({ type: 'ORDER' as const, id: o.id, reference: o.number, date: o.date, amount: round2(o.total) })),
    ].map((d) => ({ ...d, dueDate: addDays(d.date, client.paymentTermsDays), left: d.amount, paidOn: null as string | null }));

    // A credit opening balance (negative) acts like an early payment.
    const credits = [
      ...(client.openingBalance < 0 ? [{ date: openingDate, amount: -client.openingBalance }] : []),
      ...payments.map((p) => ({ date: p.date, amount: p.amount })),
    ];
    let unapplied = 0;
    let i = 0;
    for (const c of credits) {
      let left = c.amount;
      while (left > 0.005 && i < debts.length) {
        const d = debts[i];
        const take = Math.min(left, d.left);
        d.left = round2(d.left - take);
        left = round2(left - take);
        if (d.left <= 0.005) {
          d.paidOn = c.date;
          i++;
        }
      }
      unapplied = round2(unapplied + left);
    }

    const items: AgingItem[] = debts
      .filter((d) => d.left > 0.005)
      .map((d) => {
        const daysOverdue = Math.max(0, daysBetween(d.dueDate, asOf));
        return {
          type: d.type,
          id: d.id,
          reference: d.reference,
          date: d.date,
          dueDate: d.dueDate,
          amount: d.amount,
          outstanding: d.left,
          daysOverdue,
          bucket: bucketOf(daysOverdue),
        };
      });
    const aging: Record<AgingBucket, number> = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
    for (const it of items) aging[it.bucket] = round2(aging[it.bucket] + it.outstanding);

    const paidOrders = debts.filter((d) => d.type === 'ORDER' && d.paidOn);
    const weight = paidOrders.reduce((s, d) => s + d.amount, 0);
    const avgCollectionDays = weight
      ? Math.round(paidOrders.reduce((s, d) => s + d.amount * Math.max(0, daysBetween(d.date, d.paidOn!)), 0) / weight)
      : null;

    const guarantees: { type: string; status: string; amount: number | null; approvedBy: string | null; approvedAt: string | null; replaced: boolean }[] =
      await m.query(
        `SELECT type, status, amount::float AS amount, "approvedBy", to_char("approvedAt", 'YYYY-MM-DD') AS "approvedAt",
                ("paymentId" IS NOT NULL OR "replacedByGuaranteeId" IS NOT NULL) AS replaced
           FROM client_guarantees WHERE "clientId" = $1 AND "removedAt" IS NULL AND status IN ('ACTIVE', 'BOUNCED')`,
        [client.id],
      );
    const active = guarantees.filter((x) => x.status === 'ACTIVE');
    const held = active.filter((x) => x.type !== 'NO_GUARANTEE').reduce((s, x) => s + (x.amount ?? 0), 0);
    const noGuarantee = active.find((x) => x.type === 'NO_GUARANTEE');

    const overdueStopDays = client.overdueStopDays ?? DEFAULT_OVERDUE_STOP_DAYS;
    const maxDaysOverdue = items.reduce((mx, it) => Math.max(mx, it.daysOverdue), 0);
    return {
      aging,
      items,
      overdue: round2(items.filter((it) => it.daysOverdue > 0).reduce((s, it) => s + it.outstanding, 0)),
      maxDaysOverdue,
      unapplied,
      avgCollectionDays,
      paidOrders: paidOrders.length,
      coveragePct: client.creditLimit > 0 ? Math.round((held / client.creditLimit) * 100) : null,
      noGuaranteeApproval: noGuarantee
        ? { approvedBy: noGuarantee.approvedBy, approvedAt: noGuarantee.approvedAt, amount: noGuarantee.amount }
        : null,
      awaitingReplacement: guarantees.filter((x) => x.status === 'BOUNCED' && !x.replaced).length,
      overdueStopDays,
      overdueStop: overdueStopDays > 0 && maxDaysOverdue > overdueStopDays,
    };
  }

  /** Statement of account: orders as debits (order date), collected payments as credits (collection date). */
  async statement(client: Client, from: string | null, to: string | null, m: EntityManager = this.dataSource.manager): Promise<Statement> {
    const [orders, payments] = await Promise.all([this.orderTotalsOf(m, client.id), this.collectedPayments(m, client.id)]);
    const all = [
      ...orders.map((o) => ({
        date: o.date,
        type: 'ORDER' as const,
        id: o.id,
        reference: o.number,
        description: o.project ?? '',
        debit: round2(o.total),
        credit: 0,
      })),
      ...payments.map((p) => ({
        date: p.date,
        type: 'PAYMENT' as const,
        id: p.id,
        reference: p.reference ?? '',
        description: [p.method, p.bank].filter(Boolean).join(' · '),
        debit: 0,
        credit: round2(p.amount),
      })),
    ].sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === 'ORDER' ? -1 : 1));

    let opening = client.openingBalance;
    for (const e of all) if (from && e.date < from) opening += e.debit - e.credit;
    opening = round2(opening);

    let running = opening;
    const entries: StatementEntry[] = [];
    for (const e of all) {
      if ((from && e.date < from) || (to && e.date > to)) continue;
      running = round2(running + e.debit - e.credit);
      entries.push({ ...e, balance: running });
    }
    const totalDebit = round2(entries.reduce((s, e) => s + e.debit, 0));
    const totalCredit = round2(entries.reduce((s, e) => s + e.credit, 0));

    const pending: StatementHeld[] = await m.query(
      `SELECT id, method, amount::float AS amount, to_char(date, 'YYYY-MM-DD') AS date,
              to_char("dueDate", 'YYYY-MM-DD') AS "dueDate", reference, bank
         FROM payments WHERE "clientId" = $1 AND "removedAt" IS NULL AND status = 'PENDING' ORDER BY "dueDate"`,
      [client.id],
    );
    const guarantees: StatementHeld[] = await m.query(
      `SELECT id, type AS method, amount::float AS amount, to_char(date, 'YYYY-MM-DD') AS date,
              to_char("expiryDate", 'YYYY-MM-DD') AS "dueDate", reference, issuer AS bank
         FROM client_guarantees
        WHERE "clientId" = $1 AND "removedAt" IS NULL AND status = 'ACTIVE' AND type <> 'NO_GUARANTEE'
        ORDER BY date`,
      [client.id],
    );
    return {
      client: { id: client.id, name: client.name, code: client.code },
      from,
      to,
      opening,
      entries,
      totalDebit,
      totalCredit,
      closing: round2(opening + totalDebit - totalCredit),
      pending,
      guarantees,
    };
  }
}
