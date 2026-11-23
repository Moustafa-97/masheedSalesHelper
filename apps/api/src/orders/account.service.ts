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
  /** What the client owes: opening balance + orders − payments. */
  balance: number;
  /** creditLimit − balance: how much more can be ordered. */
  available: number;
  paymentTermsDays: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

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
      `SELECT COALESCE(SUM(amount), 0)::float AS paid FROM payments WHERE "clientId" = $1 AND "removedAt" IS NULL`,
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
      balance,
      available: round2(client.creditLimit - balance),
      paymentTermsDays: client.paymentTermsDays,
    };
  }
}
