import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import ExcelJS from 'exceljs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { hashPassword } from '../src/auth/password.js';
import { configureApp } from '../src/setup.js';
import { Role, User } from '../src/users/user.entity.js';

process.env.UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'uploads-'));

describe('Orders (e2e)', () => {
  let app: INestApplication;
  let admin: string[];
  let rep: string[];
  let otherRep: string[];
  let clientId: string;
  let cashClientId: string;
  let projectId: string;
  let rebar12: string;
  let rebar16: string;

  const http = () => request(app.getHttpServer());
  const as = (cookie: string[]) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    post: (url: string, body?: object) => http().post(url).set('Cookie', cookie).send(body),
    patch: (url: string, body?: object) => http().patch(url).set('Cookie', cookie).send(body),
    put: (url: string, body?: object) => http().put(url).set('Cookie', cookie).send(body),
    delete: (url: string, body?: object) => http().delete(url).set('Cookie', cookie).send(body),
  });
  const login = async (identifier: string, password: string) =>
    (await http().post('/auth/login').send({ identifier, password })).get('Set-Cookie')!;
  const upload = async (cookie: string[], name = 'note.pdf') =>
    (
      await http()
        .post('/files')
        .set('Cookie', cookie)
        .attach('file', Buffer.from('%PDF-1.4 test'), { filename: name, contentType: 'application/pdf' })
        .expect(201)
    ).body.id as string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    const users = app.get(DataSource).getRepository(User);
    await users.save(
      users.create({
        name: 'Admin',
        email: 'admin@test.com',
        passwordHash: await hashPassword('admin-pass-1'),
        role: Role.ADMIN,
      }),
    );
    admin = await login('admin@test.com', 'admin-pass-1');
    for (const email of ['rep@test.com', 'other@test.com']) {
      await as(admin).post('/users', { name: email, email, password: 'rep-pass-123', role: 'REP' }).expect(201);
    }
    rep = await login('rep@test.com', 'rep-pass-123');
    otherRep = await login('other@test.com', 'rep-pass-123');
    const repId = (await as(rep).get('/auth/me')).body.id;

    // Catalogue: rebar 12 and 16 mm, minimum 25 t
    const brand = (await as(admin).post('/brands', { name: 'Rajhi Steel' })).body.id;
    const product12 = (await as(admin).post('/products', { name: 'Rebar G60 · 12mm · 12m', category: 'Steel' })).body.id;
    const product16 = (await as(admin).post('/products', { name: 'Rebar G60 · 16mm · 12m', category: 'Steel' })).body.id;
    rebar12 = (await as(admin).post('/variants', { productId: product12, brandId: brand, unit: 'TON', minQty: 25 })).body.id;
    rebar16 = (await as(admin).post('/variants', { productId: product16, brandId: brand, unit: 'TON', minQty: 25 })).body.id;

    // A credit client (500,000 limit, 30 days) and a cash client, both the rep's
    clientId = (
      await as(admin).post('/clients', { name: 'Al Samman', creditLimit: 500000, paymentTermsDays: 30, repId })
    ).body.id;
    cashClientId = (await as(admin).post('/clients', { name: 'Cash Co', creditLimit: 0, paymentTermsDays: 0, repId })).body.id;
    projectId = (
      await as(rep).post(`/clients/${clientId}/projects`, {
        name: 'Tower A',
        mapsUrl: 'https://maps.app.goo.gl/abc123',
        contacts: 'Eng. Ali 0551234567',
      })
    ).body.id;
  });

  afterAll(() => app.close());

  const newOrder = (overrides: object = {}) => ({
    number: 'SO/26/000101',
    clientId,
    projectId,
    orderDate: '2026-11-23',
    lines: [
      { variantId: rebar12, qty: 110, unitPrice: 2800, purchasePrice: 2720 },
      { variantId: rebar16, qty: 40, unitPrice: 2780 },
    ],
    ...overrides,
  });

  let orderId: string;
  let line12: string;
  let line16: string;

  it('keeps projects per client with a maps link and contacts', async () => {
    const list = await as(rep).get(`/clients/${clientId}/projects`).expect(200);
    expect(list.body).toEqual([expect.objectContaining({ name: 'Tower A', contacts: 'Eng. Ali 0551234567' })]);
    await as(rep).post(`/clients/${clientId}/projects`, { name: 'Tower A' }).expect(409);
    await as(otherRep).get(`/clients/${clientId}/projects`).expect(404);
  });

  it('needs a reason below the minimum quantity', async () => {
    const res = await as(rep)
      .post('/orders', newOrder({ number: 'SO/26/000100', lines: [{ variantId: rebar12, qty: 10, unitPrice: 2800 }] }))
      .expect(400);
    expect(res.body.message).toMatch(/minimum of 25/);
  });

  it('creates an order with totals excl./incl. VAT and a due date from the order date', async () => {
    const res = await as(rep).post('/orders', newOrder()).expect(201);
    orderId = res.body.id;
    [line12, line16] = res.body.lines.map((l: { id: string }) => l.id);
    // 110 × 2800 + 40 × 2780 = 419,200 + 15% = 482,080
    expect(res.body.totals).toEqual({ subtotal: 419200, vat: 62880, total: 482080 });
    expect(res.body.dueDate).toBe('2026-12-23');
    expect(res.body.status).toBe('NEW');
    expect(res.body.lines[0]).toMatchObject({ description: 'Rebar G60 · 12mm · 12m — Rajhi Steel', unit: 'TON', delivered: 0 });
    expect(res.body.margin).toBeNull(); // the 16 mm line has no purchase price yet
    expect(res.body.events[0]).toMatchObject({ type: 'CREATED' });

    await as(rep).post('/orders', newOrder()).expect(409); // same number
    await as(otherRep).get(`/orders/${orderId}`).expect(404);
    const account = await as(rep).get(`/clients/${clientId}/account`).expect(200);
    expect(account.body).toMatchObject({ ordersTotal: 482080, balance: 482080, available: 17920 });
  });

  it('blocks an order over the credit limit', async () => {
    const res = await as(rep)
      .post('/orders', newOrder({ number: 'SO/26/000102', lines: [{ variantId: rebar12, qty: 25, unitPrice: 2800 }] }))
      .expect(422);
    expect(res.body).toMatchObject({ code: 'CREDIT_LIMIT', required: 80500, available: 17920 });
  });

  it('lets a cash client order only after a payment covers it', async () => {
    const order = newOrder({ number: 'SO/26/000200', clientId: cashClientId, projectId: null, lines: [{ variantId: rebar12, qty: 25, unitPrice: 2800 }] });
    expect((await as(rep).post('/orders', order).expect(422)).body.message).toMatch(/Cash client/);
    const fileId = await upload(rep, 'تحويل.pdf');
    await as(rep).post(`/clients/${cashClientId}/payments`, { amount: 80500, date: '2026-11-22', reference: 'TRX-1', fileId }).expect(201);
    await as(rep).post('/orders', order).expect(201);
    const account = await as(rep).get(`/clients/${cashClientId}/account`);
    expect(account.body).toMatchObject({ paid: 80500, balance: 0, available: 0 });
  });

  it('edits lines with the credit check, keeps removed lines visible and logs every change', async () => {
    // +10 t at 2800 = 32,200 incl. VAT, more than the 17,920 available
    await as(rep).patch(`/orders/${orderId}/lines/${line16}`, { qty: 50 }).expect(422);
    await as(rep).patch(`/orders/${orderId}/lines/${line16}`, { qty: 30, purchasePrice: 2700 }).expect(200);
    await as(rep).delete(`/orders/${orderId}/lines/${line16}`, { reason: 'Client changed the design' }).expect(200);
    await as(rep).delete(`/orders/${orderId}/lines/${line12}`, { reason: 'x'.repeat(5) }).expect(409); // last line

    const res = await as(rep).get(`/orders/${orderId}`).expect(200);
    const removed = res.body.lines.find((l: { id: string }) => l.id === line16);
    expect(removed).toMatchObject({ removedReason: 'Client changed the design', remaining: 0 });
    expect(res.body.totals.total).toBe(354200); // 110 × 2800 × 1.15
    expect(res.body.margin).toEqual({ purchaseSubtotal: 299200, amount: 8800 });
    expect(res.body.events.map((e: { type: string }) => e.type)).toEqual(['LINE_REMOVED', 'LINE_CHANGED', 'CREATED']);
    expect(res.body.events[1].data.changes).toEqual({ qty: [40, 30], purchasePrice: [null, 2700] });
  });

  it('applies one purchase price to every line', async () => {
    const res = await as(rep).put(`/orders/${orderId}/purchase-price`, { purchasePrice: 2750 }).expect(200);
    expect(res.body.lines.find((l: { id: string }) => l.id === line12).purchasePrice).toBe(2750);
    expect(res.body.lines.find((l: { id: string }) => l.id === line16).purchasePrice).toBe(2700); // removed line untouched
  });

  it('counts partial deliveries and completes the order only with full quantity, delivery note and purchase invoice', async () => {
    await as(rep).put(`/orders/${orderId}/status`, { status: 'SENT_TO_SUPPLY' }).expect(200);
    const noteFile = await upload(rep, 'سند استلام 1.pdf');
    const note = (await as(rep).post(`/orders/${orderId}/documents`, { fileId: noteFile, type: 'DELIVERY_NOTE', reference: 'DN-1' }).expect(201))
      .body.documents[0].id;

    await as(rep)
      .post(`/orders/${orderId}/deliveries`, { date: '2026-11-24', reference: 'DN-1', documentId: note, lines: [{ orderLineId: line12, qty: 20 }] })
      .expect(201);
    let res = await as(rep).get(`/orders/${orderId}`);
    expect(res.body.lines[0]).toMatchObject({ delivered: 20, remaining: 90 });

    const over = await as(rep)
      .post(`/orders/${orderId}/deliveries`, { date: '2026-11-25', lines: [{ orderLineId: line12, qty: 91 }] })
      .expect(400);
    expect(over.body.message).toMatch(/more than the 110 ordered/);
    await as(rep).post(`/orders/${orderId}/deliveries`, { date: '2026-11-25', lines: [{ orderLineId: line16, qty: 1 }] }).expect(400);

    await as(rep).post(`/orders/${orderId}/deliveries`, { date: '2026-11-25', lines: [{ orderLineId: line12, qty: 90 }] }).expect(201);
    res = await as(rep).get(`/orders/${orderId}`);
    expect(res.body.checklist).toEqual({ fullyDelivered: true, hasDeliveryNote: true, hasPurchaseInvoice: false, hasSalesInvoice: false });
    expect(res.body.status).toBe('SENT_TO_SUPPLY');
    await as(rep).put(`/orders/${orderId}/status`, { status: 'DELIVERED' }).expect(409);

    const purchase = await upload(rep, 'purchase.pdf');
    res = await as(rep).post(`/orders/${orderId}/documents`, { fileId: purchase, type: 'PURCHASE_INVOICE' }).expect(201);
    expect(res.body.status).toBe('DELIVERED');
    expect(res.body.events[0].data).toEqual({ from: 'SENT_TO_SUPPLY', to: 'DELIVERED', auto: true });

    await as(rep).patch(`/orders/${orderId}/lines/${line12}`, { qty: 100 }).expect(400); // below received
  });

  it('becomes invoiced with a sales invoice, and steps back when a delivery is removed', async () => {
    let res = await as(rep)
      .post(`/orders/${orderId}/invoices`, { number: 'INV-55', date: '2026-11-26', amount: 354200 })
      .expect(201);
    expect(res.body.status).toBe('INVOICED');

    const delivery = res.body.deliveries[1].id;
    res = await as(rep).delete(`/orders/${orderId}/deliveries/${delivery}`, { reason: 'Wrong note' }).expect(200);
    expect(res.body.status).toBe('IN_TRANSIT');
    expect(res.body.lines[0]).toMatchObject({ delivered: 20, remaining: 90 });
    expect(res.body.deliveries[1].removedReason).toBe('Wrong note');
    await as(rep).post(`/orders/${orderId}/cancel`, { reason: 'Changed mind' }).expect(409); // has deliveries
  });

  it('cancels an order, frees its credit and refuses further edits', async () => {
    const created = await as(rep)
      .post('/orders', newOrder({ number: 'SO/26/000103', lines: [{ variantId: rebar16, qty: 25, unitPrice: 300 }] }))
      .expect(201);
    const before = (await as(rep).get(`/clients/${clientId}/account`)).body.balance;
    await as(rep).post(`/orders/${created.body.id}/cancel`, { reason: 'Duplicate' }).expect(201);
    const after = (await as(rep).get(`/clients/${clientId}/account`)).body.balance;
    expect(before - after).toBe(8625);
    await as(rep).patch(`/orders/${created.body.id}`, { notes: 'x' }).expect(409);

    const list = await as(rep).get(`/orders?clientId=${clientId}`).expect(200);
    expect(list.body.map((o: { number: string; status: string }) => [o.number, o.status])).toEqual(
      expect.arrayContaining([
        ['SO/26/000101', 'IN_TRANSIT'],
        ['SO/26/000103', 'CANCELLED'],
      ]),
    );
    expect(list.body.find((o: { number: string }) => o.number === 'SO/26/000101').deliveredPct).toBe(18);
    expect((await as(otherRep).get('/orders')).body).toEqual([]);
  });

  it('serves files only to people who may see them', async () => {
    const order = (await as(rep).get(`/orders/${orderId}`)).body;
    const fileId = order.documents[0].file.id;
    const res = await as(rep).get(`/files/${fileId}`).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain("filename*=UTF-8''%D8%B3%D9%86%D8%AF");
    await as(admin).get(`/files/${fileId}`).expect(200);
    await as(otherRep).get(`/files/${fileId}`).expect(404);
    await http()
      .post('/files')
      .set('Cookie', rep)
      .attach('file', Buffer.from('MZ'), { filename: 'x.exe', contentType: 'application/x-msdownload' })
      .expect(400);
  });

  it('exports orders, lines, deliveries and a project summary to Excel', async () => {
    const res = await as(rep)
      .get(`/orders/export?clientId=${clientId}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['الطلبيات', 'البنود', 'الاستلامات', 'ملخص المشاريع']);
    expect(wb.getWorksheet('الطلبيات')!.rowCount).toBe(3);
    const summary = wb.getWorksheet('ملخص المشاريع')!.getRow(2).values as unknown[];
    expect(summary).toEqual(expect.arrayContaining(['Tower A', 'Rebar G60 · 12mm · 12m — Rajhi Steel', 110, 20, 90]));
    // The removed 16 mm line is listed, struck through, with its reason
    const lines = wb.getWorksheet('البنود')!;
    const removedRow = lines.getRows(2, lines.rowCount - 1)!.find((r) => String(r.getCell(15).value).startsWith('محذوف'));
    expect(removedRow?.font?.strike).toBe(true);
  });

  it('counts a cheque or LC only once collected, and a bounced cheque never', async () => {
    const base = `/clients/${cashClientId}`;
    await as(rep).post(`${base}/payments`, { amount: 1000, date: '2026-11-25', method: 'CHEQUE' }).expect(400); // no due date
    const cheque = (
      await as(rep)
        .post(`${base}/payments`, { amount: 50000, date: '2026-11-25', method: 'CHEQUE', dueDate: '2026-12-10', bank: 'Al Rajhi', reference: 'CHQ-881' })
        .expect(201)
    ).body;
    const lc = (await as(rep).post(`${base}/payments`, { amount: 20000, date: '2026-11-25', method: 'LC', dueDate: '2027-01-15' }).expect(201)).body;
    expect(cheque).toMatchObject({ status: 'PENDING', collectedDate: null });

    let account = (await as(rep).get(`${base}/account`)).body;
    expect(account).toMatchObject({ paid: 80500, pending: 70000, available: 0 });

    await as(rep).put(`${base}/payments/${cheque.id}/status`, { status: 'RECEIVED', collectedDate: '2026-12-10' }).expect(200);
    await as(rep).put(`${base}/payments/${lc.id}/status`, { status: 'BOUNCED', reason: 'Documents rejected' }).expect(200);
    account = (await as(rep).get(`${base}/account`)).body;
    expect(account).toMatchObject({ paid: 130500, pending: 0, available: 50000 });
  });

  it('builds a statement of account with a running balance', async () => {
    const all = (await as(rep).get(`/clients/${cashClientId}/statement`).expect(200)).body;
    expect(all.opening).toBe(0);
    expect(all.entries.map((e: { type: string; debit: number; credit: number; balance: number }) => [e.type, e.debit, e.credit, e.balance])).toEqual([
      ['PAYMENT', 0, 80500, -80500],
      ['ORDER', 80500, 0, 0],
      ['PAYMENT', 0, 50000, -50000],
    ]);
    expect(all.closing).toBe(-50000);

    const window = (await as(rep).get(`/clients/${cashClientId}/statement?from=2026-11-23&to=2026-11-30`)).body;
    expect(window.opening).toBe(-80500);
    expect(window.entries).toHaveLength(1);
    expect(window.closing).toBe(0);

    const xlsx = await as(rep)
      .get(`/clients/${cashClientId}/statement/export`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body);
    expect(wb.worksheets[0].getCell('A1').value).toBe('كشف حساب: Cash Co');
    await as(otherRep).get(`/clients/${cashClientId}/statement`).expect(404);
  });

  it('sets one sale price on every line, within the credit limit', async () => {
    const order = (
      await as(rep)
        .post('/orders', newOrder({ number: 'SO/26/000300', lines: [{ variantId: rebar12, qty: 25, unitPrice: 100 }, { variantId: rebar16, qty: 25, unitPrice: 100 }] }))
        .expect(201)
    ).body;
    const res = await as(rep).put(`/orders/${order.id}/unit-price`, { unitPrice: 150 }).expect(200);
    expect(res.body.lines.map((l: { unitPrice: number }) => l.unitPrice)).toEqual([150, 150]);
    expect(res.body.events[0]).toMatchObject({ type: 'UNIT_PRICE_SET' });
    await as(rep).put(`/orders/${order.id}/unit-price`, { unitPrice: 9999 }).expect(422);
  });

  it('splits open and completed orders and counts them for the dashboard', async () => {
    const open = (await as(rep).get('/orders?state=open')).body.map((o: { number: string }) => o.number);
    const cancelled = (await as(rep).get('/orders?state=cancelled')).body.map((o: { number: string }) => o.number);
    expect(open).toEqual(expect.arrayContaining(['SO/26/000101', 'SO/26/000300']));
    expect(cancelled).toEqual(['SO/26/000103']);
    expect((await as(rep).get('/orders?state=done')).body).toEqual([]);

    const summary = (await as(rep).get('/orders/summary').expect(200)).body;
    expect(summary).toMatchObject({ open: open.length, done: 0, cancelled: 1, staleDays: 3, staleCount: 0 });
    expect(summary.byStatus.NEW).toBeGreaterThan(0);
  });

  describe('approved cheques raise the available credit while held', () => {
    const base = () => `/clients/${cashClientId}`;
    const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

    it('counts the approved amount until the cheque is collected, with no double counting', async () => {
      const before = (await as(rep).get(`${base()}/account`)).body.available;
      const cheque = (
        await as(rep).post(`${base()}/payments`, { amount: 100000, date: future(0), method: 'CHEQUE', dueDate: future(20) }).expect(201)
      ).body;
      await as(rep).put(`${base()}/payments/${cheque.id}/approval`, { amount: 90000 }).expect(400); // who approved?
      await as(rep).put(`${base()}/payments/${cheque.id}/approval`, { amount: 120000, approvedBy: 'GM' }).expect(400);
      const proof = await upload(rep, 'approval.pdf');
      await as(rep).put(`${base()}/payments/${cheque.id}/approval`, { amount: 90000, approvedBy: 'Sales manager', fileId: proof }).expect(200);

      let account = (await as(rep).get(`${base()}/account`)).body;
      expect(account).toMatchObject({ approvedCredit: 90000, available: before + 90000 });

      const order = await as(rep)
        .post('/orders', newOrder({ number: 'SO/26/000400', clientId: cashClientId, projectId: null, lines: [{ variantId: rebar12, qty: 25, unitPrice: 4000 }] }))
        .expect(201); // 115,000 incl. VAT: fits only with the cheque
      expect(order.body.events[0].data.usedApprovedCredit).toBe(90000);

      const list = (await as(rep).get(`${base()}/payments`)).body;
      expect(list.find((p: { id: string }) => p.id === cheque.id)).toMatchObject({ approvalValid: true, approvalUntil: future(23), approvalFile: { id: proof } });

      await as(rep).put(`${base()}/payments/${cheque.id}/status`, { status: 'RECEIVED' }).expect(200);
      account = (await as(rep).get(`${base()}/account`)).body;
      expect(account.approvedCredit).toBe(0);
      expect(account.available).toBe(Math.round((before + 100000 - 115000) * 100) / 100);
    });

    it('holds a guarantee cheque for six months, then returns it to the client', async () => {
      const g = (
        await as(rep)
          .post(`${base()}/payments`, { amount: 200000, date: future(0), method: 'CHEQUE', purpose: 'GUARANTEE', dueDate: future(0) })
          .expect(201)
      ).body;
      expect(g).toMatchObject({ purpose: 'GUARANTEE', status: 'PENDING' });
      await as(rep).put(`${base()}/payments/${g.id}/approval`, { amount: 180000, approvedBy: 'GM' }).expect(200);
      let account = (await as(rep).get(`${base()}/account`)).body;
      expect(account).toMatchObject({ guarantees: 200000, approvedCredit: 180000 });
      const statement = (await as(rep).get(`${base()}/statement`)).body;
      expect(statement.guarantees.map((x: { id: string }) => x.id)).toEqual([g.id]);

      await as(rep).put(`${base()}/payments/${g.id}/status`, { status: 'RETURNED', reason: 'Paid by transfer' }).expect(200);
      account = (await as(rep).get(`${base()}/account`)).body;
      expect(account).toMatchObject({ guarantees: 0, approvedCredit: 0 });

      await as(rep).post(`${base()}/payments`, { amount: 10, date: future(0), method: 'TRANSFER', purpose: 'GUARANTEE' }).expect(400);
      const transfer = (await as(rep).post(`${base()}/payments`, { amount: 10, date: future(0) }).expect(201)).body;
      await as(rep).put(`${base()}/payments/${transfer.id}/status`, { status: 'RETURNED' }).expect(400);
    });

    it('stops counting an approval past its date and lists the cheque for an update', async () => {
      const old = (
        await as(rep).post(`${base()}/payments`, { amount: 50000, date: future(-30), method: 'CHEQUE', dueDate: future(-10) }).expect(201)
      ).body;
      await as(rep).put(`${base()}/payments/${old.id}/approval`, { amount: 45000, approvedBy: 'GM' }).expect(200);
      const account = (await as(rep).get(`${base()}/account`)).body;
      expect(account.approvedCredit).toBe(0);
      const summary = (await as(rep).get('/orders/summary')).body;
      expect(summary.chequesToUpdate).toEqual([expect.objectContaining({ id: old.id, clientName: 'Cash Co', approved: true })]);
      expect((await as(otherRep).get('/orders/summary')).body.chequesToUpdate).toEqual([]);
    });
  });
});
