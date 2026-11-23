import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import ExcelJS from 'exceljs';
import { Brackets, DataSource } from 'typeorm';
import { Role, User } from '../users/user.entity.js';
import { addDays, orderTotals } from './account.service.js';
import { Delivery, Order, OrderStatus } from './order.entities.js';
import { ListOrdersQuery } from './orders.dto.js';

const STATUS_AR: Record<OrderStatus, string> = {
  NEW: 'جديدة',
  SENT_TO_SUPPLY: 'اتبعتت للتوريد',
  SUPPLY_RECEIVED: 'استلمها التوريد',
  AT_SUPPLIER: 'عند المورد',
  IN_TRANSIT: 'في الطريق',
  DELIVERED: 'اتسلّمت',
  INVOICED: 'اتفوترت',
  CANCELLED: 'ملغية',
};

const UNIT_AR: Record<string, string> = {
  TON: 'طن',
  BAG: 'كيس',
  M3: 'م³',
  PIECE: 'حبة',
  KG: 'كجم',
  METER: 'متر',
  GALLON: 'جالون',
  TRAILER: 'تريلا',
};

type Col = { header: string; key: string; width: number; numFmt?: string };
const MONEY = '#,##0.00';
const QTY = '#,##0.###';

/**
 * The rep's own data as a workbook: orders, their lines (with purchase price and margin),
 * deliveries, and a per-project summary of quantities ordered and received.
 */
@Injectable()
export class OrdersExportService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async workbook(user: User, query: ListOrdersQuery): Promise<Buffer> {
    const qb = this.dataSource
      .getRepository(Order)
      .createQueryBuilder('o')
      .innerJoinAndSelect('o.client', 'client')
      .leftJoinAndSelect('o.project', 'project')
      .leftJoinAndSelect('o.lines', 'line')
      .orderBy('o.orderDate', 'ASC')
      .addOrderBy('line.position', 'ASC');
    if (user.role === Role.REP) qb.andWhere('client.repId = :repId', { repId: user.id });
    else if (user.role !== Role.ADMIN) qb.andWhere('1 = 0');
    if (query.clientId) qb.andWhere('o.clientId = :clientId', { clientId: query.clientId });
    if (query.projectId) qb.andWhere('o.projectId = :projectId', { projectId: query.projectId });
    if (query.status) qb.andWhere('o.status = :status', { status: query.status });
    if (query.from) qb.andWhere('o.orderDate >= :from', { from: query.from });
    if (query.to) qb.andWhere('o.orderDate <= :to', { to: query.to });
    if (query.q) {
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('o.number ILIKE :q', { q: `%${query.q}%` })
            .orWhere('client.name ILIKE :q')
            .orWhere('project.name ILIKE :q'),
        ),
      );
    }
    const orders = await qb.getMany();
    const orderIds = orders.map((o) => o.id);
    const deliveries = orderIds.length
      ? await this.dataSource.getRepository(Delivery).find({
          where: orderIds.map((orderId) => ({ orderId })),
          relations: { lines: true },
          order: { date: 'ASC' },
        })
      : [];
    const received = new Map<string, number>();
    for (const d of deliveries.filter((d) => !d.removedAt)) {
      for (const l of d.lines) received.set(l.orderLineId, (received.get(l.orderLineId) ?? 0) + l.qty);
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Masheed Sales Helper';
    wb.created = new Date();
    const sheet = (name: string, columns: Col[]) => {
      const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
      ws.columns = columns.map(({ header, key, width }) => ({ header, key, width }));
      columns.forEach((c, i) => c.numFmt && (ws.getColumn(i + 1).numFmt = c.numFmt));
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B3D33' } };
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
      return ws;
    };

    // Orders
    const ordersWs = sheet('الطلبيات', [
      { header: 'رقم الطلبية', key: 'number', width: 18 },
      { header: 'التاريخ', key: 'date', width: 12 },
      { header: 'العميل', key: 'client', width: 30 },
      { header: 'المشروع', key: 'project', width: 26 },
      { header: 'الحالة', key: 'status', width: 16 },
      { header: 'قبل الضريبة', key: 'subtotal', width: 14, numFmt: MONEY },
      { header: 'الضريبة', key: 'vat', width: 12, numFmt: MONEY },
      { header: 'الإجمالي', key: 'total', width: 14, numFmt: MONEY },
      { header: 'الاستحقاق', key: 'due', width: 12 },
      { header: 'نسبة الاستلام %', key: 'pct', width: 14 },
      { header: 'ملاحظات', key: 'notes', width: 30 },
    ]);
    for (const o of orders) {
      const t = orderTotals(o.lines, o.vatRate);
      const active = o.lines.filter((l) => !l.removedAt);
      const ordered = active.reduce((s, l) => s + l.qty, 0);
      const got = active.reduce((s, l) => s + Math.min(received.get(l.id) ?? 0, l.qty), 0);
      ordersWs.addRow({
        number: o.number,
        date: o.orderDate,
        client: o.client.name,
        project: o.project?.name ?? '',
        status: STATUS_AR[o.status],
        subtotal: o.status === OrderStatus.CANCELLED ? 0 : t.subtotal,
        vat: o.status === OrderStatus.CANCELLED ? 0 : t.vat,
        total: o.status === OrderStatus.CANCELLED ? 0 : t.total,
        due: addDays(o.orderDate, o.client.paymentTermsDays),
        pct: ordered ? Math.round((got / ordered) * 100) : 0,
        notes: o.status === OrderStatus.CANCELLED ? `ملغية: ${o.cancelReason ?? ''}` : (o.notes ?? ''),
      });
    }

    // Lines
    const linesWs = sheet('البنود', [
      { header: 'رقم الطلبية', key: 'number', width: 18 },
      { header: 'التاريخ', key: 'date', width: 12 },
      { header: 'العميل', key: 'client', width: 28 },
      { header: 'المشروع', key: 'project', width: 24 },
      { header: 'الصنف', key: 'item', width: 44 },
      { header: 'اللون', key: 'color', width: 10 },
      { header: 'الوحدة', key: 'unit', width: 8 },
      { header: 'الكمية', key: 'qty', width: 10, numFmt: QTY },
      { header: 'المستلم', key: 'received', width: 10, numFmt: QTY },
      { header: 'المتبقي', key: 'remaining', width: 10, numFmt: QTY },
      { header: 'سعر البيع', key: 'price', width: 12, numFmt: MONEY },
      { header: 'قيمة البيع', key: 'value', width: 14, numFmt: MONEY },
      { header: 'سعر الشراء', key: 'cost', width: 12, numFmt: MONEY },
      { header: 'الهامش', key: 'margin', width: 14, numFmt: MONEY },
      { header: 'ملاحظة', key: 'note', width: 30 },
    ]);
    for (const o of orders) {
      for (const l of o.lines) {
        const off = Boolean(l.removedAt) || o.status === OrderStatus.CANCELLED;
        const got = received.get(l.id) ?? 0;
        const row = linesWs.addRow({
          number: o.number,
          date: o.orderDate,
          client: o.client.name,
          project: o.project?.name ?? '',
          item: l.description,
          color: l.color ?? '',
          unit: UNIT_AR[l.unit] ?? l.unit,
          qty: l.qty,
          received: got,
          remaining: off ? 0 : Math.max(l.qty - got, 0),
          price: l.unitPrice,
          value: off ? 0 : Math.round(l.qty * l.unitPrice * 100) / 100,
          cost: l.purchasePrice ?? null,
          margin: off || l.purchasePrice === null ? null : Math.round(l.qty * (l.unitPrice - l.purchasePrice) * 100) / 100,
          note: l.removedAt ? `محذوف: ${l.removedReason ?? ''}` : (l.belowMinReason ? `أقل من الحد الأدنى: ${l.belowMinReason}` : ''),
        });
        if (off) row.font = { strike: true, color: { argb: 'FF8A8A8A' } };
      }
    }

    // Deliveries
    const lineById = new Map(orders.flatMap((o) => o.lines.map((l) => [l.id, { l, o }] as const)));
    const delWs = sheet('الاستلامات', [
      { header: 'التاريخ', key: 'date', width: 12 },
      { header: 'رقم الطلبية', key: 'number', width: 18 },
      { header: 'العميل', key: 'client', width: 28 },
      { header: 'المشروع', key: 'project', width: 24 },
      { header: 'رقم السند', key: 'ref', width: 14 },
      { header: 'الصنف', key: 'item', width: 44 },
      { header: 'الكمية', key: 'qty', width: 10, numFmt: QTY },
      { header: 'الوحدة', key: 'unit', width: 8 },
    ]);
    for (const d of deliveries) {
      for (const dl of d.lines) {
        const hit = lineById.get(dl.orderLineId);
        if (!hit) continue;
        const row = delWs.addRow({
          date: d.date,
          number: hit.o.number,
          client: hit.o.client.name,
          project: hit.o.project?.name ?? '',
          ref: d.reference ?? '',
          item: hit.l.description,
          qty: dl.qty,
          unit: UNIT_AR[hit.l.unit] ?? hit.l.unit,
        });
        if (d.removedAt) row.font = { strike: true, color: { argb: 'FF8A8A8A' } };
      }
    }

    // Per project and item: ordered vs received
    const summary = new Map<string, { client: string; project: string; item: string; unit: string; qty: number; received: number; value: number }>();
    for (const o of orders) {
      if (o.status === OrderStatus.CANCELLED) continue;
      for (const l of o.lines.filter((l) => !l.removedAt)) {
        const key = `${o.clientId}|${o.projectId ?? ''}|${l.description}|${l.unit}`;
        const s = summary.get(key) ?? {
          client: o.client.name,
          project: o.project?.name ?? '—',
          item: l.description,
          unit: UNIT_AR[l.unit] ?? l.unit,
          qty: 0,
          received: 0,
          value: 0,
        };
        s.qty += l.qty;
        s.received += received.get(l.id) ?? 0;
        s.value += l.qty * l.unitPrice;
        summary.set(key, s);
      }
    }
    const sumWs = sheet('ملخص المشاريع', [
      { header: 'العميل', key: 'client', width: 28 },
      { header: 'المشروع', key: 'project', width: 26 },
      { header: 'الصنف', key: 'item', width: 44 },
      { header: 'الوحدة', key: 'unit', width: 8 },
      { header: 'المطلوب', key: 'qty', width: 12, numFmt: QTY },
      { header: 'المستلم', key: 'received', width: 12, numFmt: QTY },
      { header: 'المتبقي', key: 'remaining', width: 12, numFmt: QTY },
      { header: 'القيمة قبل الضريبة', key: 'value', width: 18, numFmt: MONEY },
    ]);
    [...summary.values()]
      .sort((a, b) => a.client.localeCompare(b.client) || a.project.localeCompare(b.project) || a.item.localeCompare(b.item))
      .forEach((s) =>
        sumWs.addRow({ ...s, remaining: Math.max(s.qty - s.received, 0), value: Math.round(s.value * 100) / 100 }),
      );

    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
