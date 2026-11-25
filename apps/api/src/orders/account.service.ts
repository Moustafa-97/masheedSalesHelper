import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { Client } from '../clients/client.entity.js';
import { Role, User } from '../users/user.entity.js';

export interface ClientAccount {
  creditLimit: number;
  openingBalance: number;
  /** All orders that aren't cancelled, incl. VAT, removed lines excluded. */
  ordersTotal: number;
  paid: number;
  /** Cheques and LCs for collection, not collected yet: shown, not counted. */
  pending: number;
  /** Cheques and LCs held as guarantees. */
  guarantees: number;
  /** Management-approved temporary credit on held cheques / LCs, still valid today. */
  approvedCredit: number;
  /** What the client owes: opening balance + orders − payments. */
  balance: number;
  /** creditLimit − balance + approvedCredit: how much more can be ordered. */
  available: number;
  paymentTermsDays: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Days after a collection cheque's date during which its approval still counts (time to clear). */
export const APPROVAL_GRACE_DAYS = 3;
/** A guarantee cheque / LC is held for six months from its date. */
export const GUARANTEE_MONTHS = 6;

/** Last day an approval counts, as SQL on the payments table. */
export const APPROVAL_UNTIL_SQL = `(CASE WHEN purpose = 'GUARANTEE'
    THEN "dueDate" + INTERVAL '${GUARANTEE_MONTHS} months'
    ELSE "dueDate" + INTERVAL '${APPROVAL_GRACE_DAYS} days' END)::date`;

export const APPROVAL_VALID_SQL = `status = 'PENDING' AND "creditApprovedAmount" > 0 AND CURRENT_DATE <= ${APPROVAL_UNTIL_SQL}`;

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

@Injectable()
export class AccountService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * The client, if this user may work with it: admins any client, reps their own.
   * Pass `lock` inside a transaction to serialise credit checks for the same client.
   */
  async clientFor(user: User, clientId: string, m: EntityManager = this.dataSource.manager, lock = false) {
    if (user.role !== Role.ADMIN && user.role !== Role.REP) throw new ForbiddenException();
    const qb = m
      .getRepository(Client)
      .createQueryBuilder('c')
      .where('c.id = :clientId', { clientId });
    if (user.role === Role.REP) qb.andWhere('c.repId = :repId', { repId: user.id });
    if (lock) qb.setLock('pessimistic_write');
    const client = await qb.getOne();
    if (!client) throw new NotFoundException('Client not found');
    return client;
  }

  async account(client: Client, m: EntityManager = this.dataSource.manager): Promise<ClientAccount> {
    const [orders] = await m.query(
      `SELECT COALESCE(SUM(t.sub + ROUND(t.sub * t.rate / 100, 2)), 0)::float AS total
         FROM (SELECT ROUND(SUM(l.qty * l."unitPrice"), 2) AS sub, o."vatRate" AS rate
                 FROM orders o JOIN order_lines l ON l."orderId" = o.id
                WHERE o."clientId" = $1 AND o.status <> 'CANCELLED' AND l."removedAt" IS NULL
                GROUP BY o.id, o."vatRate") t`,
      [client.id],
    );
    const [payments] = await m.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'RECEIVED'), 0)::float AS paid,
              COALESCE(SUM(amount) FILTER (WHERE status = 'PENDING' AND purpose = 'PAYMENT'), 0)::float AS pending,
              COALESCE(SUM(amount) FILTER (WHERE status = 'PENDING' AND purpose = 'GUARANTEE'), 0)::float AS guarantees,
              COALESCE(SUM("creditApprovedAmount") FILTER (WHERE ${APPROVAL_VALID_SQL}), 0)::float AS approved
         FROM payments WHERE "clientId" = $1 AND "removedAt" IS NULL`,
      [client.id],
    );
    const ordersTotal = round2(orders.total);
    const paid = round2(payments.paid);
    const balance = round2(client.openingBalance + ordersTotal - paid);
    return {
      creditLimit: client.creditLimit,
      openingBalance: client.openingBalance,
      ordersTotal,
      paid,
      pending: round2(payments.pending),
      guarantees: round2(payments.guarantees),
      approvedCredit: round2(payments.approved),
      balance,
      available: round2(client.creditLimit - balance + payments.approved),
      paymentTermsDays: client.paymentTermsDays,
    };
  }
}

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
  amount: number;
  date: string;
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
  /** Cheques and LCs received but not collected yet (not in the balance). */
  pending: StatementHeld[];
  /** Cheques and LCs held as guarantees. */
  guarantees: StatementHeld[];
}

/**
 * Statement of account: orders (by order date, incl. VAT, removed lines and cancelled orders
 * left out) as debits, collected payments (by collection date) as credits, with a running balance.
 */
export async function buildStatement(
  m: EntityManager,
  client: Client,
  from: string | null,
  to: string | null,
): Promise<Statement> {
  const orders: { id: string; number: string; date: string; project: string | null; total: number }[] = await m.query(
    `SELECT o.id, o.number, to_char(o."orderDate", 'YYYY-MM-DD') AS date, p.name AS project,
            (ROUND(SUM(l.qty * l."unitPrice"), 2) + ROUND(ROUND(SUM(l.qty * l."unitPrice"), 2) * o."vatRate" / 100, 2))::float AS total
       FROM orders o
       JOIN order_lines l ON l."orderId" = o.id AND l."removedAt" IS NULL
       LEFT JOIN client_projects p ON p.id = o."projectId"
      WHERE o."clientId" = $1 AND o.status <> 'CANCELLED'
      GROUP BY o.id, p.name`,
    [client.id],
  );
  const payments: {
    id: string;
    method: string;
    status: string;
    amount: number;
    date: string;
    collected: string | null;
    dueDate: string | null;
    reference: string | null;
    bank: string | null;
    purpose: string;
  }[] = await m.query(
    `SELECT id, method, status, purpose, amount::float AS amount, to_char(date, 'YYYY-MM-DD') AS date,
            to_char("collectedDate", 'YYYY-MM-DD') AS collected, to_char("dueDate", 'YYYY-MM-DD') AS "dueDate",
            reference, bank
       FROM payments WHERE "clientId" = $1 AND "removedAt" IS NULL AND status IN ('PENDING', 'RECEIVED')`,
    [client.id],
  );

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
    ...payments
      .filter((p) => p.status === 'RECEIVED')
      .map((p) => ({
        date: p.collected ?? p.date,
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
  return {
    client: { id: client.id, name: client.name, code: client.code },
    from,
    to,
    opening,
    entries,
    totalDebit,
    totalCredit,
    closing: round2(opening + totalDebit - totalCredit),
    pending: payments.filter((p) => p.status === 'PENDING' && p.purpose === 'PAYMENT').map(held),
    guarantees: payments.filter((p) => p.status === 'PENDING' && p.purpose === 'GUARANTEE').map(held),
  };
}

const held = ({ id, method, amount, date, dueDate, reference, bank }: StatementHeld & Record<string, unknown>): StatementHeld => ({
  id,
  method,
  amount,
  date,
  dueDate,
  reference,
  bank,
});
