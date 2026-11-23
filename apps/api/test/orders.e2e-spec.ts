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
});
