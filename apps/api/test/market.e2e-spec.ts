import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { hashPassword } from '../src/auth/password.js';
import { configureApp } from '../src/setup.js';
import { Role, User } from '../src/users/user.entity.js';

describe('Lost deals and market prices (e2e)', () => {
  let app: INestApplication;
  let admin: string[];
  let rep: string[];
  let otherRep: string[];
  let client: string;
  let r12: string;
  let r16: string;

  const http = () => request(app.getHttpServer());
  const as = (cookie: string[]) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    post: (url: string, body?: object) => http().post(url).set('Cookie', cookie).send(body),
    patch: (url: string, body?: object) => http().patch(url).set('Cookie', cookie).send(body),
    put: (url: string, body?: object) => http().put(url).set('Cookie', cookie).send(body),
    delete: (url: string) => http().delete(url).set('Cookie', cookie),
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
    r12 = await variant('Rebar 12mm');
    r16 = await variant('Rebar 16mm');
    client = (await as(admin).post('/clients', { name: 'Al Khalig', code: 'B2B-722', creditLimit: 500000, paymentTermsDays: 45, repId })).body.id;
  });

  afterAll(() => app.close());

  const price = (extra: object = {}) => ({
    date: '2026-11-20',
    name: 'Rajhi 12',
    variantIds: [r12],
    unit: 'TON',
    price: 2750,
    creditDays: 0,
    competitor: 'Rajhi',
    source: 'MARKET',
    ...extra,
  });

  it('keeps one competitor per name, whatever the spelling case, and lets the admin merge two', async () => {
    const a = await as(rep).post('/competitors', { name: 'Rajhi' }).expect(201);
    const b = await as(rep).post('/competitors', { name: '  rajhi ' }).expect(201);
    expect(b.body.id).toBe(a.body.id);
    const arabic = await as(rep).post('/competitors', { name: 'الراجحي' }).expect(201);
    await as(rep).post(`/competitors/${arabic.body.id}/merge`, { intoId: a.body.id }).expect(403);
    await as(admin).post('/market-prices', price({ competitor: 'الراجحي' })).expect(201);
    await as(admin).post(`/competitors/${arabic.body.id}/merge`, { intoId: a.body.id }).expect(201);
    const list = (await as(rep).get('/competitors')).body;
    expect(list).toEqual([{ id: a.body.id, name: 'Rajhi', uses: 1 }]);
  });

  it('records prices with their payment terms, mine only for a rep, everything for the admin', async () => {
    await as(rep).post('/market-prices', price()).expect(201);
    await as(rep).post('/market-prices', price({ price: 2830, creditDays: 45 })).expect(201);
    await as(rep).post('/market-prices', price({ source: 'LOST_DEAL' })).expect(400); // automatic only
    await as(otherRep).post('/market-prices', price({ price: 2700, date: '2026-11-21' })).expect(201);

    const mine = (await as(rep).get('/market-prices')).body;
    expect(mine.map((p: { price: number; creditDays: number }) => [p.price, p.creditDays])).toEqual([[2830, 45], [2750, 0]]); // newest first
    expect((await as(admin).get('/market-prices')).body).toHaveLength(4);

    // The hint while pricing: the latest price per payment terms.
    const hint = (await as(rep).get(`/market-prices/latest?variantIds=${r12},${r16}`)).body;
    expect(hint).toHaveLength(2);
    expect(hint).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ variantId: r12, price: 2750, creditDays: 0, competitor: 'Rajhi' }),
        expect.objectContaining({ variantId: r12, price: 2830, creditDays: 45 }),
      ]),
    );
  });

  it('records a deal lost without a quotation, and its prices go to the market prices', async () => {
    await as(rep)
      .post('/lost-deals', { date: '2026-11-22', reason: 'PRICE', creditDays: 45, competitorCreditDays: 45, lines: [{ name: 'x', unit: 'TON', qty: 1 }] })
      .expect(400); // no client
    const deal = await as(rep)
      .post('/lost-deals', {
        date: '2026-11-22',
        clientName: 'Sarh Contracting',
        zone: 'Riyadh',
        reason: 'PAYMENT_TERMS',
        note: 'They give 90 days',
        competitor: 'RAJHI',
        creditDays: 45,
        competitorCreditDays: 90,
        lines: [{ name: 'Rajhi 16', variantIds: [r16], unit: 'TON', qty: 200, ourPrice: 2800, competitorPrice: 2860 }],
      })
      .expect(201);
    expect(deal.body).toMatchObject({ kind: 'DEAL', client: { name: 'Sarh Contracting' }, value: 560000, competitor: { name: 'Rajhi' } });

    const auto = (await as(rep).get(`/market-prices?variantId=${r16}`)).body;
    expect(auto).toEqual([expect.objectContaining({ price: 2860, creditDays: 90, source: 'LOST_DEAL', automatic: true, zone: 'Riyadh' })]);
    await as(rep).delete(`/market-prices/${auto[0].id}`).expect(403); // changed from the deal
    await as(otherRep).get(`/lost-deals/${deal.body.id}`).expect(404);

    // Editing the deal replaces its market prices.
    await as(rep)
      .patch(`/lost-deals/${deal.body.id}`, {
        date: '2026-11-22',
        clientId: client,
        reason: 'PAYMENT_TERMS',
        competitor: 'Rajhi',
        creditDays: 45,
        competitorCreditDays: 90,
        lines: [{ name: 'Rajhi 16', variantIds: [r16], unit: 'TON', qty: 200, ourPrice: 2800, competitorPrice: 2850 }],
      })
      .expect(200);
    expect((await as(rep).get(`/market-prices?variantId=${r16}`)).body.map((p: { price: number }) => p.price)).toEqual([2850]);
  });

  it('lists lost quotations with lost deals, and compares prices at the same terms', async () => {
    // Accepted at 45 days: our price for r12 on credit.
    const won = (
      await as(rep).post('/quotations', {
        clientId: client,
        date: '2026-11-15',
        terms: '- Payment: Credit 45 days.',
        lines: [{ name: 'Rajhi 12', variantIds: [r12], unit: 'TON', qty: 100, unitPrice: 2850 }],
      })
    ).body;
    expect(won.creditDays).toBe(45); // the client's terms
    await as(rep).put(`/quotations/${won.id}/status`, { status: 'ACCEPTED', acceptedAt: '2026-11-16' }).expect(200);
    const lostQ = (
      await as(rep).post('/quotations', {
        clientId: client,
        date: '2026-11-18',
        creditDays: 0,
        terms: '- Payment: Cash.',
        lines: [{ name: 'Rajhi 12', variantIds: [r12], unit: 'TON', qty: 50, unitPrice: 2780 }],
      })
    ).body;
    await as(rep)
      .put(`/quotations/${lostQ.id}/status`, {
        status: 'LOST',
        lostAt: '2026-11-19',
        lostReasonCode: 'PRICE',
        competitor: 'rajhi',
        linePrices: [{ lineId: lostQ.lines[0].id, price: 2740 }],
      })
      .expect(200);

    const lost = (await as(rep).get('/lost-deals?from=2026-11-01&to=2026-11-30')).body;
    expect(lost.map((e: { kind: string; value: number }) => [e.kind, e.value])).toEqual([
      ['DEAL', 560000],
      ['QUOTATION', 139000],
    ]);
    expect((await as(rep).get('/lost-deals?from=2026-11-01&to=2026-11-30&reason=PRICE')).body).toHaveLength(1);
    expect((await as(otherRep).get('/lost-deals?from=2026-11-01&to=2026-11-30')).body).toEqual([]);

    const a = (await as(rep).get('/market/analysis?from=2026-11-01&to=2026-11-30')).body;
    const r12Credit = a.items.find((i: { variantId: string; creditDays: number }) => i.variantId === r12 && i.creditDays === 45);
    // Market 2830 on 45 days against our accepted 2850 on 45 days: we are 0.71% above.
    expect(r12Credit).toMatchObject({ market: { price: 2830 }, ours: { price: 2850 }, diffPct: 0.71 });
    const r12Cash = a.items.find((i: { variantId: string; creditDays: number }) => i.variantId === r12 && i.creditDays === 0);
    expect(r12Cash).toMatchObject({ market: { price: 2750, date: '2026-11-20' }, lowest: { price: 2740, date: '2026-11-19' }, ours: null, count: 2 });
    expect(a.lost).toMatchObject({ count: 2, value: 699000 });
    expect(a.lost.byReason).toEqual([
      { key: 'PAYMENT_TERMS', count: 1, value: 560000 },
      { key: 'PRICE', count: 1, value: 139000 },
    ]);
    expect(a.lost.byCompetitor).toEqual([{ key: 'Rajhi', count: 2, value: 699000 }]);
    expect(a.quotations).toMatchObject({ won: 1, lost: 1, winRate: 50 });

    // The admin sees everyone's prices, so the cash market price is the other rep's 2700.
    const all = (await as(admin).get('/market/analysis?from=2026-11-01&to=2026-11-30')).body;
    expect(all.items.find((i: { variantId: string; creditDays: number }) => i.variantId === r12 && i.creditDays === 0).lowest.price).toBe(2700);
  });
});
