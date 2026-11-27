import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { hashPassword } from '../src/auth/password.js';
import { configureApp } from '../src/setup.js';
import { Role, User } from '../src/users/user.entity.js';

describe('Quotations (e2e)', () => {
  let app: INestApplication;
  let admin: string[];
  let rep: string[];
  let otherRep: string[];
  let coded: string;
  let prospect: string;
  let r12: string;
  let r16: string;
  let r32: string;

  const http = () => request(app.getHttpServer());
  const as = (cookie: string[]) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    post: (url: string, body?: object) => http().post(url).set('Cookie', cookie).send(body),
    patch: (url: string, body?: object) => http().patch(url).set('Cookie', cookie).send(body),
    put: (url: string, body?: object) => http().put(url).set('Cookie', cookie).send(body),
  });
  const login = async (identifier: string, password: string) =>
    (await http().post('/auth/login').send({ identifier, password })).get('Set-Cookie')!;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    const users = app.get(DataSource).getRepository(User);
    await users.save(
      users.create({ name: 'Admin', email: 'admin@test.com', passwordHash: await hashPassword('admin-pass-1'), role: Role.ADMIN }),
    );
    admin = await login('admin@test.com', 'admin-pass-1');
    for (const email of ['rep@test.com', 'other@test.com']) {
      await as(admin).post('/users', { name: email, email, password: 'rep-pass-123', role: 'REP' }).expect(201);
    }
    rep = await login('rep@test.com', 'rep-pass-123');
    otherRep = await login('other@test.com', 'rep-pass-123');
    const repId = (await as(rep).get('/auth/me')).body.id;

    const brand = (await as(admin).post('/brands', { name: 'Rajhi Steel' })).body.id;
    const variant = async (name: string) => {
      const productId = (await as(admin).post('/products', { name, category: 'Steel' })).body.id;
      return (await as(admin).post('/variants', { productId, brandId: brand, unit: 'TON' })).body.id as string;
    };
    r12 = await variant('Rebar G60 · 12mm · 12m');
    r16 = await variant('Rebar G60 · 16mm · 12m');
    r32 = await variant('Rebar G60 · 32mm · 12m');

    coded = (await as(admin).post('/clients', { name: 'Al Khalig', code: 'B2B-722', creditLimit: 500000, paymentTermsDays: 60, repId })).body.id;
    prospect = (await as(rep).post('/clients', { name: 'New Builder Co', status: 'PROSPECT' })).body.id;
  });

  afterAll(() => app.close());

  const quote = (clientId: string, lines: object[], extra: object = {}) => ({
    clientId,
    date: '2026-11-27',
    attn: 'Eng. AbdulRahim',
    terms: '- Payment: Credit.\n- Price Validity: 7 day.',
    lines,
    ...extra,
  });
  const rajhi = (price: number) => ({ name: 'Rajhi 12-32', variantIds: [r12, r16, r32], unit: 'TON', qty: 100, unitPrice: price });

  let first: string;

  it("numbers quotations by the client's code, or NEW- for a new client", async () => {
    const a = await as(rep).post('/quotations', quote(coded, [rajhi(2750)])).expect(201);
    const b = await as(rep).post('/quotations', quote(coded, [rajhi(2760)])).expect(201);
    const c = await as(rep).post('/quotations', quote(prospect, [{ name: 'يمامة تشطيب', unit: 'BAG', qty: 580, unitPrice: 9.4 }])).expect(201);
    first = a.body.id;
    expect([a.body.number, b.body.number, c.body.number]).toEqual(['B2B-722-00001', 'B2B-722-00002', 'NEW-00001']);
    // 580 × 9.40 = 5,452 + 15% = 6,269.80, as on the paper template
    expect(c.body.totals).toEqual({ subtotal: 5452, vat: 817.8, total: 6269.8 });
    expect(a.body.createdBy).toMatchObject({ name: 'rep@test.com', email: 'rep@test.com' });
    expect(a.body.lines[0].items.map((i: { name: string }) => i.name)).toEqual([
      'Rebar G60 · 12mm · 12m — Rajhi Steel',
      'Rebar G60 · 16mm · 12m — Rajhi Steel',
      'Rebar G60 · 32mm · 12m — Rajhi Steel',
    ]);
  });

  it("keeps each client's quotations and hides them from other reps", async () => {
    const list = (await as(rep).get(`/quotations?clientId=${coded}`).expect(200)).body;
    expect(list.map((q: { number: string }) => q.number)).toEqual(['B2B-722-00002', 'B2B-722-00001']);
    expect((await as(otherRep).get('/quotations')).body).toEqual([]);
    await as(otherRep).get(`/quotations/${first}`).expect(404);
    await as(otherRep).post('/quotations', quote(coded, [rajhi(1)])).expect(404);
  });

  it('edits a draft, sets the PDF name, and refuses unknown items', async () => {
    const res = await as(rep)
      .patch(`/quotations/${first}`, { pdfName: 'Quotation Al Khalig rebar', lines: [rajhi(2740), { name: 'Delivery', unit: 'TRAILER', qty: 1, unitPrice: 0 }] })
      .expect(200);
    expect(res.body).toMatchObject({ pdfName: 'Quotation Al Khalig rebar' });
    expect(res.body.lines.map((l: { name: string }) => l.name)).toEqual(['Rajhi 12-32', 'Delivery']);
    await as(rep)
      .patch(`/quotations/${first}`, { lines: [{ name: 'x', variantIds: ['00000000-0000-4000-8000-000000000000'], unit: 'TON', qty: 1, unitPrice: 1 }] })
      .expect(400);
  });

  it('turns accepted prices into the client accepted prices, latest first', async () => {
    await as(rep).put(`/quotations/${first}/status`, { status: 'SENT' }).expect(200);
    await as(rep).put(`/quotations/${first}/status`, { status: 'ACCEPTED', acceptedAt: '2026-11-28' }).expect(200);
    let prices = (await as(rep).get(`/clients/${coded}/accepted-prices`).expect(200)).body;
    expect(prices).toHaveLength(3);
    expect(prices.every((p: { unitPrice: number; number: string }) => p.unitPrice === 2740 && p.number === 'B2B-722-00001')).toBe(true);

    // A later accepted quotation for 16 mm only wins for 16 mm
    const later = (await as(rep).post('/quotations', quote(coded, [{ name: 'Rajhi 16', variantIds: [r16], unit: 'TON', qty: 50, unitPrice: 2700 }]))).body;
    await as(rep).put(`/quotations/${later.id}/status`, { status: 'ACCEPTED', acceptedAt: '2026-12-02' }).expect(200);
    prices = (await as(rep).get(`/clients/${coded}/accepted-prices`)).body;
    const byVariant = Object.fromEntries(prices.map((p: { variantId: string; unitPrice: number }) => [p.variantId, p.unitPrice]));
    expect(byVariant).toEqual({ [r12]: 2740, [r16]: 2700, [r32]: 2740 });

    await as(rep).patch(`/quotations/${first}`, { notes: 'x' }).expect(409); // closed
  });

  it('records why a quotation was lost, and duplicates it as a new draft', async () => {
    const lostOne = (await as(rep).post('/quotations', quote(prospect, [rajhi(2790)]))).body;
    await as(rep).put(`/quotations/${lostOne.id}/status`, { status: 'LOST' }).expect(400);
    const lost = await as(rep)
      .put(`/quotations/${lostOne.id}/status`, { status: 'LOST', lostReason: 'Cheaper elsewhere', competitor: 'Factory direct', competitorPrice: 2720 })
      .expect(200);
    expect(lost.body).toMatchObject({ status: 'LOST', competitorPrice: 2720 });
    expect((await as(rep).get(`/clients/${prospect}/accepted-prices`)).body).toEqual([]);

    const copy = await as(rep).post(`/quotations/${lostOne.id}/duplicate`).expect(201);
    expect(copy.body).toMatchObject({ status: 'DRAFT', number: 'NEW-00003', attn: 'Eng. AbdulRahim' });
    expect(copy.body.lines[0]).toMatchObject({ name: 'Rajhi 12-32', unitPrice: 2790 });
  });
});
