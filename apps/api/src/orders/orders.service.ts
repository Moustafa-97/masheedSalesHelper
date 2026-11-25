import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In, IsNull, SelectQueryBuilder } from 'typeorm';
import { Client, ClientStatus } from '../clients/client.entity.js';
import { ProductVariant } from '../products/product.entities.js';
import { Role, User } from '../users/user.entity.js';
import { isUniqueViolation } from '../users/users.module.js';
import { AccountService, addDays, APPROVAL_UNTIL_SQL, orderTotals } from './account.service.js';
import {
  ClientProject,
  Delivery,
  DeliveryLine,
  DocumentType,
  ORDER_FLOW,
  Order,
  OrderDocument,
  OrderEvent,
  OrderLine,
  OrderStatus,
  SalesInvoice,
  StoredFile,
} from './order.entities.js';
import {
  AddDeliveryDto,
  AddDocumentDto,
  AddInvoiceDto,
  CreateOrderDto,
  ListOrdersQuery,
  OrderLineDto,
  UpdateLineDto,
  UpdateOrderDto,
} from './orders.dto.js';

const round3 = (n: number) => Math.round(n * 1000) / 1000;

const DONE = [OrderStatus.DELIVERED, OrderStatus.INVOICED];
const OPEN = ORDER_FLOW.filter((s) => !DONE.includes(s));

/** open: still being supplied; done: delivered or invoiced; cancelled. */
export function applyState(qb: SelectQueryBuilder<Order>, state?: 'open' | 'done' | 'cancelled') {
  if (state === 'open') qb.andWhere('o.status IN (:...open)', { open: OPEN });
  if (state === 'done') qb.andWhere('o.status IN (:...done)', { done: DONE });
  if (state === 'cancelled') qb.andWhere('o.status = :cancelled', { cancelled: OrderStatus.CANCELLED });
}
type PricedLine = { id?: string; qty: number; unitPrice: number; removedAt: Date | null };
const BEFORE_DELIVERED = ORDER_FLOW.slice(0, ORDER_FLOW.indexOf(OrderStatus.DELIVERED));

@Injectable()
export class OrdersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly accounts: AccountService,
  ) {}

  /* ---------- Reading ---------- */

  async list(user: User, query: ListOrdersQuery) {
    const qb = this.dataSource
      .getRepository(Order)
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.client', 'client')
      .leftJoinAndSelect('o.project', 'project')
      .leftJoinAndSelect('o.lines', 'line')
      .orderBy('o.orderDate', 'DESC')
      .addOrderBy('o.createdAt', 'DESC');
    this.scopeQuery(qb, user);
    if (query.clientId) qb.andWhere('o.clientId = :clientId', { clientId: query.clientId });
    if (query.projectId) qb.andWhere('o.projectId = :projectId', { projectId: query.projectId });
    if (query.status) qb.andWhere('o.status = :status', { status: query.status });
    applyState(qb, query.state);
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
    const delivered = await this.deliveredByLine(
      this.dataSource.manager,
      orders.flatMap((o) => o.lines.map((l) => l.id)),
    );
    const activity = await this.lastActivity(orders.map((o) => o.id));
    return orders.map((o) => {
      const active = o.lines.filter((l) => !l.removedAt);
      const ordered = active.reduce((s, l) => s + l.qty, 0);
      const got = active.reduce((s, l) => s + Math.min(delivered.get(l.id) ?? 0, l.qty), 0);
      return {
        id: o.id,
        number: o.number,
        orderDate: o.orderDate,
        status: o.status,
        client: { id: o.client.id, name: o.client.name },
        project: o.project ? { id: o.project.id, name: o.project.name } : null,
        lineCount: active.length,
        totals: orderTotals(o.lines, o.vatRate),
        dueDate: addDays(o.orderDate, o.client.paymentTermsDays),
        deliveredPct: ordered ? Math.round((got / ordered) * 100) : 0,
        lastActivityAt: activity.get(o.id) ?? o.updatedAt,
      };
    });
  }

  /**
   * Dashboard counts: open orders (not delivered yet), the open ones nobody has touched for
   * `staleDays` days, and completed ones (delivered or invoiced).
   */
  async summary(user: User, staleDays = 3) {
    const open = await this.list(user, { state: 'open' });
    const [done, cancelled] = await Promise.all([
      this.countState(user, 'done'),
      this.countState(user, 'cancelled'),
    ]);
    const cutoff = Date.now() - staleDays * 24 * 3600 * 1000;
    const stale = open
      .filter((o) => new Date(o.lastActivityAt).getTime() < cutoff)
      .sort((a, b) => new Date(a.lastActivityAt).getTime() - new Date(b.lastActivityAt).getTime());
    const qb = this.dataSource
      .createQueryBuilder()
      .select(['p.id AS id', 'p.method AS method', 'p.purpose AS purpose', 'p.amount::float AS amount'])
      .addSelect(`to_char(p."dueDate", 'YYYY-MM-DD')`, 'dueDate')
      .addSelect('c.id', 'clientId')
      .addSelect('c.name', 'clientName')
      .addSelect('p."creditApprovedAmount" IS NOT NULL', 'approved')
      .from('payments', 'p')
      .innerJoin('clients', 'c', 'c.id = p."clientId"')
      .where(`p.status = 'PENDING' AND p."removedAt" IS NULL`)
      // Collection cheques past their date; guarantees past their six months.
      .andWhere(`CURRENT_DATE > (CASE WHEN p.purpose = 'GUARANTEE' THEN ${APPROVAL_UNTIL_SQL.replaceAll('"dueDate"', 'p."dueDate"').replaceAll('purpose', 'p.purpose')} ELSE p."dueDate" END)`)
      .orderBy('p."dueDate"', 'ASC');
    if (user.role === Role.REP) qb.andWhere('c."repId" = :repId', { repId: user.id });
    const chequesToUpdate: {
      id: string;
      method: string;
      purpose: string;
      amount: number;
      dueDate: string;
      clientId: string;
      clientName: string;
      approved: boolean;
    }[] = await qb.getRawMany();
    return {
      open: open.length,
      done,
      cancelled,
      staleDays,
      stale: stale.slice(0, 10),
      staleCount: stale.length,
      chequesToUpdate,
      byStatus: open.reduce<Record<string, number>>((acc, o) => ((acc[o.status] = (acc[o.status] ?? 0) + 1), acc), {}),
    };
  }

  private async countState(user: User, state: 'done' | 'cancelled') {
    const qb = this.dataSource.getRepository(Order).createQueryBuilder('o').innerJoin('o.client', 'client');
    this.scopeQuery(qb, user);
    applyState(qb, state);
    return qb.getCount();
  }

  private async lastActivity(orderIds: string[]) {
    if (!orderIds.length) return new Map<string, Date>();
    const rows: { orderId: string; at: Date }[] = await this.dataSource
      .createQueryBuilder(OrderEvent, 'e')
      .select('e.orderId', 'orderId')
      .addSelect('MAX(e.createdAt)', 'at')
      .where('e.orderId IN (:...orderIds)', { orderIds })
      .groupBy('e.orderId')
      .getRawMany();
    return new Map(rows.map((r) => [r.orderId, new Date(r.at)]));
  }

  async get(user: User, id: string, m: EntityManager = this.dataSource.manager) {
    const order = await this.orderFor(user, id, m);
    const [lines, documents, deliveries, invoices, events] = await Promise.all([
      m.find(OrderLine, { where: { orderId: id }, order: { position: 'ASC' }, relations: { variant: true } }),
      m.find(OrderDocument, { where: { orderId: id }, relations: { file: true }, order: { createdAt: 'ASC' } }),
      m.find(Delivery, { where: { orderId: id }, relations: { lines: true }, order: { date: 'ASC', createdAt: 'ASC' } }),
      m.find(SalesInvoice, { where: { orderId: id }, order: { date: 'ASC' } }),
      m.find(OrderEvent, { where: { orderId: id }, relations: { user: true }, order: { createdAt: 'DESC' } }),
    ]);
    const delivered = await this.deliveredByLine(m, lines.map((l) => l.id));
    const active = lines.filter((l) => !l.removedAt);
    const totals = orderTotals(lines, order.vatRate);
    const priced = active.filter((l) => l.purchasePrice !== null);
    const purchaseSubtotal = Math.round(priced.reduce((s, l) => s + l.qty * l.purchasePrice!, 0) * 100) / 100;
    const checklist = this.checklist(lines, delivered, documents, invoices);

    return {
      ...order,
      client: {
        id: order.client.id,
        name: order.client.name,
        paymentTermsDays: order.client.paymentTermsDays,
        purchasingName: order.client.purchasingName,
        purchasingPhone: order.client.purchasingPhone,
      },
      createdBy: { id: order.createdBy.id, name: order.createdBy.name },
      lines: lines.map(({ variant, ...l }) => ({
        ...l,
        minQty: variant.minQty,
        delivered: round3(delivered.get(l.id) ?? 0),
        remaining: l.removedAt ? 0 : round3(Math.max(l.qty - (delivered.get(l.id) ?? 0), 0)),
      })),
      totals,
      /** Only when every active line has a purchase price. */
      margin:
        active.length && priced.length === active.length
          ? { purchaseSubtotal, amount: Math.round((totals.subtotal - purchaseSubtotal) * 100) / 100 }
          : null,
      dueDate: addDays(order.orderDate, order.client.paymentTermsDays),
      checklist,
      documents: documents.map(({ file, ...d }) => ({
        ...d,
        file: { id: file.id, originalName: file.originalName, mimeType: file.mimeType, size: file.size },
      })),
      deliveries,
      invoices,
      events: events.map(({ user: u, ...e }) => ({ ...e, user: { id: u.id, name: u.name } })),
    };
  }

  /* ---------- Creating and editing ---------- */

  async create(user: User, dto: CreateOrderDto) {
    const id = await this.write(async (m) => {
      const client = await this.accounts.clientFor(user, dto.clientId, m, true);
      if (client.status !== ClientStatus.ACTIVE) {
        throw new ConflictException('Only active clients can order; change the client status first');
      }
      if (dto.projectId) await this.projectOf(m, client.id, dto.projectId);

      const lines = await this.buildLines(m, dto.lines);
      const order = await m.save(
        m.create(Order, {
          number: dto.number.trim(),
          clientId: client.id,
          projectId: dto.projectId ?? null,
          createdById: user.id,
          orderDate: dto.orderDate,
          notes: dto.notes ?? null,
        }),
      );
      const total = orderTotals(lines, order.vatRate).total;
      const account = await this.creditCheck(m, client, total);
      await m.save(lines.map((l, i) => m.create(OrderLine, { ...l, orderId: order.id, position: i })));
      await this.event(m, order.id, user, 'CREATED', {
        number: order.number,
        total,
        // The order only fits thanks to approved cheques / LCs: kept on record.
        ...(account && account.approvedCredit > 0 && total > account.available - account.approvedCredit + 0.005
          ? { usedApprovedCredit: account.approvedCredit }
          : {}),
      });
      return order.id;
    });
    return this.get(user, id);
  }

  async update(user: User, id: string, dto: UpdateOrderDto) {
    await this.write(async (m) => {
      const order = await this.editable(user, id, m);
      if (dto.projectId) await this.projectOf(m, order.clientId, dto.projectId);
      const changes: Record<string, [unknown, unknown]> = {};
      for (const key of ['number', 'projectId', 'orderDate', 'notes'] as const) {
        const next = key === 'number' && dto.number ? dto.number.trim() : dto[key];
        if (next !== undefined && next !== order[key]) changes[key] = [order[key], next];
      }
      if (!Object.keys(changes).length) return;
      await m.update(Order, { id }, Object.fromEntries(Object.entries(changes).map(([k, [, v]]) => [k, v])));
      await this.event(m, id, user, 'UPDATED', changes);
    });
    return this.get(user, id);
  }

  async addLine(user: User, id: string, dto: OrderLineDto) {
    await this.write(async (m) => {
      const order = await this.editable(user, id, m, true);
      const [line] = await this.buildLines(m, [dto]);
      const extra = await this.totalDelta(m, order, (lines) => [...lines, line]);
      await this.creditCheck(m, order.client, extra);
      const position = (await m.count(OrderLine, { where: { orderId: id } })) + 1;
      const saved = await m.save(m.create(OrderLine, { ...line, orderId: id, position }));
      await this.event(m, id, user, 'LINE_ADDED', {
        lineId: saved.id,
        description: saved.description,
        qty: saved.qty,
        unitPrice: saved.unitPrice,
      });
      await this.syncStatus(m, order, user);
    });
    return this.get(user, id);
  }

  async updateLine(user: User, id: string, lineId: string, dto: UpdateLineDto) {
    await this.write(async (m) => {
      const order = await this.editable(user, id, m, true);
      const line = await this.activeLine(m, id, lineId);
      const qty = dto.qty ?? line.qty;
      const unitPrice = dto.unitPrice ?? line.unitPrice;

      if (dto.qty !== undefined) {
        const got = (await this.deliveredByLine(m, [lineId])).get(lineId) ?? 0;
        if (qty < got - 0.0005) {
          throw new BadRequestException(`Already received ${round3(got)}; the quantity can't be lower`);
        }
        const minQty = (await m.findOneByOrFail(ProductVariant, { id: line.variantId })).minQty;
        const reason = dto.belowMinReason ?? line.belowMinReason;
        if (minQty !== null && qty < minQty && !reason?.trim()) {
          throw new BadRequestException(`Below the minimum of ${minQty}: give a reason`);
        }
      }

      const extra = await this.totalDelta(m, order, (lines) =>
        lines.map((l) => (l.id === lineId ? { ...l, qty, unitPrice } : l)),
      );
      if (extra > 0) await this.creditCheck(m, order.client, extra);

      const changes: Record<string, [unknown, unknown]> = {};
      for (const key of ['qty', 'unitPrice', 'purchasePrice', 'color', 'belowMinReason'] as const) {
        if (dto[key] !== undefined && dto[key] !== line[key]) changes[key] = [line[key], dto[key]];
      }
      if (!Object.keys(changes).length) return;
      await m.update(OrderLine, { id: lineId }, Object.fromEntries(Object.entries(changes).map(([k, [, v]]) => [k, v])));
      await this.event(m, id, user, 'LINE_CHANGED', { lineId, description: line.description, changes });
      await this.syncStatus(m, order, user);
    });
    return this.get(user, id);
  }

  async removeLine(user: User, id: string, lineId: string, reason: string) {
    await this.write(async (m) => {
      const order = await this.editable(user, id, m);
      const line = await this.activeLine(m, id, lineId);
      if ((await this.deliveredByLine(m, [lineId])).get(lineId)) {
        throw new ConflictException('This line has deliveries; remove them first or lower the quantity');
      }
      const left = await m.count(OrderLine, { where: { orderId: id, removedAt: IsNull() } });
      if (left <= 1) throw new ConflictException('An order needs at least one line; cancel the order instead');
      await m.update(OrderLine, { id: lineId }, { removedAt: new Date(), removedReason: reason });
      await this.event(m, id, user, 'LINE_REMOVED', {
        lineId,
        description: line.description,
        qty: line.qty,
        unitPrice: line.unitPrice,
        reason,
      });
      await this.syncStatus(m, order, user);
    });
    return this.get(user, id);
  }

  /** One sale price for every active line (e.g. all rebar diameters at the same price per ton). */
  async setUnitPrice(user: User, id: string, unitPrice: number) {
    await this.write(async (m) => {
      const order = await this.editable(user, id, m, true);
      const extra = await this.totalDelta(m, order, (lines) => lines.map((l) => ({ ...l, unitPrice })));
      await this.creditCheck(m, order.client, extra);
      const result = await m.update(OrderLine, { orderId: id, removedAt: IsNull() }, { unitPrice });
      await this.event(m, id, user, 'UNIT_PRICE_SET', { unitPrice, lines: result.affected });
    });
    return this.get(user, id);
  }

  /** One purchase price for every active line (e.g. all rebar diameters at the same price per ton). */
  async setPurchasePrice(user: User, id: string, purchasePrice: number) {
    await this.write(async (m) => {
      await this.editable(user, id, m);
      const result = await m.update(OrderLine, { orderId: id, removedAt: IsNull() }, { purchasePrice });
      await this.event(m, id, user, 'PURCHASE_PRICE_SET', { purchasePrice, lines: result.affected });
    });
    return this.get(user, id);
  }

  async setStatus(user: User, id: string, status: OrderStatus) {
    await this.write(async (m) => {
      const order = await this.editable(user, id, m);
      if (status === OrderStatus.CANCELLED) throw new BadRequestException('Use cancel, with a reason');
      if (status === order.status) return;
      if (status === OrderStatus.DELIVERED || status === OrderStatus.INVOICED) {
        const c = await this.loadChecklist(m, id);
        const missing = [
          !c.fullyDelivered && 'every line fully received',
          !c.hasDeliveryNote && 'a delivery note',
          !c.hasPurchaseInvoice && 'a purchase invoice',
          status === OrderStatus.INVOICED && !c.hasSalesInvoice && 'a sales invoice',
        ].filter(Boolean);
        if (missing.length) throw new ConflictException(`Still needed: ${missing.join(', ')}`);
      }
      await m.update(Order, { id }, { status });
      await this.event(m, id, user, 'STATUS', { from: order.status, to: status });
    });
    return this.get(user, id);
  }

  async cancel(user: User, id: string, reason: string) {
    await this.write(async (m) => {
      const order = await this.editable(user, id, m);
      const delivered = await m.count(Delivery, { where: { orderId: id, removedAt: IsNull() } });
      if (delivered) {
        throw new ConflictException('This order has deliveries; remove them or lower the quantities instead');
      }
      await m.update(Order, { id }, { status: OrderStatus.CANCELLED, cancelledAt: new Date(), cancelReason: reason });
      await this.event(m, id, user, 'CANCELLED', { from: order.status, reason });
    });
    return this.get(user, id);
  }

  /* ---------- Documents, deliveries, invoices ---------- */

  async addDocument(user: User, id: string, dto: AddDocumentDto) {
    await this.write(async (m) => {
      const order = await this.editable(user, id, m);
      const file = await m.findOneBy(StoredFile, { id: dto.fileId });
      if (!file || (user.role !== Role.ADMIN && file.uploadedById !== user.id)) {
        throw new NotFoundException('File not found');
      }
      const doc = await m.save(
        m.create(OrderDocument, {
          orderId: id,
          fileId: file.id,
          type: dto.type,
          reference: dto.reference?.trim() || null,
          createdById: user.id,
        }),
      );
      await this.event(m, id, user, 'DOCUMENT_ADDED', {
        documentId: doc.id,
        type: doc.type,
        reference: doc.reference,
        name: file.originalName,
      });
      await this.syncStatus(m, order, user);
    });
    return this.get(user, id);
  }

  async removeDocument(user: User, id: string, documentId: string, reason: string) {
    await this.write(async (m) => {
      const order = await this.editable(user, id, m);
      const doc = await m.findOneBy(OrderDocument, { id: documentId, orderId: id, removedAt: IsNull() });
      if (!doc) throw new NotFoundException('Document not found');
      await m.update(OrderDocument, { id: documentId }, { removedAt: new Date(), removedReason: reason });
      await this.event(m, id, user, 'DOCUMENT_REMOVED', { documentId, type: doc.type, reference: doc.reference, reason });
      await this.syncStatus(m, order, user);
    });
    return this.get(user, id);
  }

  async addDelivery(user: User, id: string, dto: AddDeliveryDto) {
    await this.write(async (m) => {
      const order = await this.editable(user, id, m, true);
      if (dto.documentId) await this.documentOf(m, id, dto.documentId, DocumentType.DELIVERY_NOTE);

      const lines = await m.find(OrderLine, { where: { orderId: id, removedAt: IsNull() } });
      const byId = new Map(lines.map((l) => [l.id, l]));
      const delivered = await this.deliveredByLine(m, lines.map((l) => l.id));
      const seen = new Set<string>();
      for (const d of dto.lines) {
        const line = byId.get(d.orderLineId);
        if (!line) throw new BadRequestException('A delivery line is not an active line of this order');
        if (seen.has(d.orderLineId)) throw new BadRequestException('Each order line once per delivery');
        seen.add(d.orderLineId);
        const after = round3((delivered.get(line.id) ?? 0) + d.qty);
        if (after > line.qty + 0.0005) {
          throw new BadRequestException(
            `${line.description}: ${after} received would be more than the ${line.qty} ordered; correct the order quantity first`,
          );
        }
      }

      const delivery = await m.save(
        m.create(Delivery, {
          orderId: id,
          date: dto.date,
          reference: dto.reference?.trim() || null,
          documentId: dto.documentId ?? null,
          notes: dto.notes ?? null,
          createdById: user.id,
        }),
      );
      await m.save(dto.lines.map((l) => m.create(DeliveryLine, { deliveryId: delivery.id, ...l })));
      await this.event(m, id, user, 'DELIVERY_ADDED', {
        deliveryId: delivery.id,
        date: dto.date,
        reference: delivery.reference,
        lines: dto.lines.map((l) => ({ description: byId.get(l.orderLineId)!.description, qty: l.qty })),
      });
      await this.syncStatus(m, order, user);
    });
    return this.get(user, id);
  }

  async removeDelivery(user: User, id: string, deliveryId: string, reason: string) {
    await this.write(async (m) => {
      const order = await this.editable(user, id, m);
      const delivery = await m.findOneBy(Delivery, { id: deliveryId, orderId: id, removedAt: IsNull() });
      if (!delivery) throw new NotFoundException('Delivery not found');
      await m.update(Delivery, { id: deliveryId }, { removedAt: new Date(), removedReason: reason });
      await this.event(m, id, user, 'DELIVERY_REMOVED', { deliveryId, date: delivery.date, reason });
      await this.syncStatus(m, order, user);
    });
    return this.get(user, id);
  }

  async addInvoice(user: User, id: string, dto: AddInvoiceDto) {
    await this.write(async (m) => {
      const order = await this.editable(user, id, m);
      if (dto.documentId) await this.documentOf(m, id, dto.documentId, DocumentType.SALES_INVOICE);
      const invoice = await m.save(
        m.create(SalesInvoice, {
          orderId: id,
          number: dto.number.trim(),
          date: dto.date,
          amount: dto.amount,
          documentId: dto.documentId ?? null,
          createdById: user.id,
        }),
      );
      await this.event(m, id, user, 'INVOICE_ADDED', {
        invoiceId: invoice.id,
        number: invoice.number,
        date: invoice.date,
        amount: invoice.amount,
      });
      await this.syncStatus(m, order, user);
    });
    return this.get(user, id);
  }

  async removeInvoice(user: User, id: string, invoiceId: string, reason: string) {
    await this.write(async (m) => {
      const order = await this.editable(user, id, m);
      const invoice = await m.findOneBy(SalesInvoice, { id: invoiceId, orderId: id, removedAt: IsNull() });
      if (!invoice) throw new NotFoundException('Invoice not found');
      await m.update(SalesInvoice, { id: invoiceId }, { removedAt: new Date(), removedReason: reason });
      await this.event(m, id, user, 'INVOICE_REMOVED', { invoiceId, number: invoice.number, reason });
      await this.syncStatus(m, order, user);
    });
    return this.get(user, id);
  }

  /* ---------- Helpers ---------- */

  private async write<T>(work: (m: EntityManager) => Promise<T>): Promise<T> {
    try {
      return await this.dataSource.transaction(work);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('An order with this number already exists');
      throw e;
    }
  }

  private scopeQuery(qb: SelectQueryBuilder<Order>, user: User) {
    if (user.role === Role.REP) qb.andWhere('client.repId = :repId', { repId: user.id });
    else if (user.role !== Role.ADMIN) qb.andWhere('1 = 0');
  }

  private async orderFor(user: User, id: string, m: EntityManager, lock = false) {
    const qb = m
      .getRepository(Order)
      .createQueryBuilder('o')
      .innerJoinAndSelect('o.client', 'client')
      .leftJoinAndSelect('o.project', 'project')
      .innerJoinAndSelect('o.createdBy', 'createdBy')
      .where('o.id = :id', { id });
    this.scopeQuery(qb, user);
    if (lock) qb.setLock('pessimistic_write', undefined, ['o', 'client']);
    const order = await qb.getOne();
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  /** The order, unless it is cancelled. `lock` also locks the client row for a credit check. */
  private async editable(user: User, id: string, m: EntityManager, lock = false) {
    const order = await this.orderFor(user, id, m, lock);
    if (order.status === OrderStatus.CANCELLED) throw new ConflictException('This order is cancelled');
    return order;
  }

  private async activeLine(m: EntityManager, orderId: string, lineId: string) {
    const line = await m.findOneBy(OrderLine, { id: lineId, orderId });
    if (!line) throw new NotFoundException('Line not found');
    if (line.removedAt) throw new ConflictException('This line was removed');
    return line;
  }

  private async projectOf(m: EntityManager, clientId: string, projectId: string) {
    const project = await m.findOneBy(ClientProject, { id: projectId, clientId });
    if (!project) throw new BadRequestException("The project isn't one of this client's projects");
    return project;
  }

  private async documentOf(m: EntityManager, orderId: string, documentId: string, type: DocumentType) {
    const doc = await m.findOneBy(OrderDocument, { id: documentId, orderId, type, removedAt: IsNull() });
    if (!doc) throw new BadRequestException(`Attach a ${type} document of this order`);
    return doc;
  }

  /** Validates items and minimums, and snapshots each line's description and unit. */
  private async buildLines(m: EntityManager, dtos: OrderLineDto[]) {
    const variants = await m.find(ProductVariant, {
      where: { id: In(dtos.map((d) => d.variantId)) },
      relations: { product: true, brand: true },
    });
    const byId = new Map(variants.map((v) => [v.id, v]));
    return dtos.map((d) => {
      const v = byId.get(d.variantId);
      if (!v || !v.isActive) throw new BadRequestException('An item is not in the active catalogue');
      if (v.minQty !== null && d.qty < v.minQty && !d.belowMinReason?.trim()) {
        throw new BadRequestException(`${v.product.name}: below the minimum of ${v.minQty}; give a reason`);
      }
      const description = [v.product.name, v.spec, v.brand?.name].filter(Boolean).join(' — ');
      return {
        variantId: v.id,
        description,
        unit: v.unit,
        qty: d.qty,
        unitPrice: d.unitPrice,
        purchasePrice: d.purchasePrice ?? null,
        color: d.color?.trim() || null,
        belowMinReason: d.belowMinReason?.trim() || null,
        removedAt: null,
      };
    });
  }

  /** How much the order total (incl. VAT) grows when its active lines are changed by `change`. */
  private async totalDelta(
    m: EntityManager,
    order: Order,
    change: (lines: PricedLine[]) => PricedLine[],
  ) {
    const lines: PricedLine[] = await m.find(OrderLine, { where: { orderId: order.id, removedAt: IsNull() } });
    return orderTotals(change(lines), order.vatRate).total - orderTotals(lines, order.vatRate).total;
  }

  private async creditCheck(m: EntityManager, client: Client, extra: number) {
    if (extra <= 0) return null;
    const account = await this.accounts.account(client, m);
    if (extra > account.available + 0.005) {
      throw new UnprocessableEntityException({
        message:
          client.creditLimit > 0
            ? `Over the credit limit: this needs ${extra.toFixed(2)} and ${account.available.toFixed(2)} is available`
            : `Cash client: record a payment covering ${extra.toFixed(2)} first (${account.available.toFixed(2)} available)`,
        code: 'CREDIT_LIMIT',
        required: Math.round(extra * 100) / 100,
        available: account.available,
      });
    }
    return account;
  }

  private async deliveredByLine(m: EntityManager, lineIds: string[]) {
    if (!lineIds.length) return new Map<string, number>();
    const rows: { orderLineId: string; qty: number }[] = await m
      .createQueryBuilder(DeliveryLine, 'dl')
      .innerJoin('dl.delivery', 'd')
      .select('dl.orderLineId', 'orderLineId')
      .addSelect('SUM(dl.qty)::float', 'qty')
      .where('dl.orderLineId IN (:...lineIds)', { lineIds })
      .andWhere('d.removedAt IS NULL')
      .groupBy('dl.orderLineId')
      .getRawMany();
    return new Map(rows.map((r) => [r.orderLineId, Number(r.qty)]));
  }

  private checklist(
    lines: OrderLine[],
    delivered: Map<string, number>,
    documents: OrderDocument[],
    invoices: SalesInvoice[],
  ) {
    const active = lines.filter((l) => !l.removedAt);
    const docs = documents.filter((d) => !d.removedAt);
    return {
      fullyDelivered: active.length > 0 && active.every((l) => (delivered.get(l.id) ?? 0) >= l.qty - 0.0005),
      hasDeliveryNote: docs.some((d) => d.type === DocumentType.DELIVERY_NOTE),
      hasPurchaseInvoice: docs.some((d) => d.type === DocumentType.PURCHASE_INVOICE),
      hasSalesInvoice: invoices.some((i) => !i.removedAt),
    };
  }

  private async loadChecklist(m: EntityManager, orderId: string) {
    const [lines, documents, invoices] = await Promise.all([
      m.find(OrderLine, { where: { orderId } }),
      m.find(OrderDocument, { where: { orderId } }),
      m.find(SalesInvoice, { where: { orderId } }),
    ]);
    return this.checklist(lines, await this.deliveredByLine(m, lines.map((l) => l.id)), documents, invoices);
  }

  /**
   * Moves the order to DELIVERED once every line is fully received with a delivery note and a
   * purchase invoice, to INVOICED once a sales invoice is added, and back when that stops being true.
   */
  private async syncStatus(m: EntityManager, order: Order, user: User) {
    const { status } = await m.findOneByOrFail(Order, { id: order.id });
    const c = await this.loadChecklist(m, order.id);
    const complete = c.fullyDelivered && c.hasDeliveryNote && c.hasPurchaseInvoice;
    let next = status;
    if (BEFORE_DELIVERED.includes(status) && complete) next = OrderStatus.DELIVERED;
    if (next === OrderStatus.DELIVERED && c.hasSalesInvoice) next = OrderStatus.INVOICED;
    if ((next === OrderStatus.DELIVERED || next === OrderStatus.INVOICED) && !complete) next = OrderStatus.IN_TRANSIT;
    if (next === OrderStatus.INVOICED && !c.hasSalesInvoice) next = OrderStatus.DELIVERED;
    if (next === status) return;
    await m.update(Order, { id: order.id }, { status: next });
    await this.event(m, order.id, user, 'STATUS', { from: status, to: next, auto: true });
  }

  private event(m: EntityManager, orderId: string, user: User, type: string, data: Record<string, unknown>) {
    return m.save(m.create(OrderEvent, { orderId, userId: user.id, type, data }));
  }
}
