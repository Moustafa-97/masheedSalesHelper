import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { hashPassword } from '../src/auth/password.js';
import { configureApp } from '../src/setup.js';
import { Role, User } from '../src/users/user.entity.js';

describe('Phase 1 API (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string[];

  const login = async (identifier: string, password: string) => {
    const res = await request(app.getHttpServer()).post('/auth/login').send({ identifier, password });
    return res;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    const users = app.get(DataSource).getRepository(User);
    await users.save(
      users.create({
        name: 'Admin',
        email: 'admin@test.com',
        phone: '966551112222',
        passwordHash: await hashPassword('admin-pass-1'),
        role: Role.ADMIN,
      }),
    );
    const res = await login('admin@test.com', 'admin-pass-1');
    adminCookie = res.get('Set-Cookie')!;
  });

  afterAll(() => app.close());

  it('rejects a wrong password and an unknown user the same way', async () => {
    expect((await login('admin@test.com', 'nope-nope')).status).toBe(401);
    expect((await login('ghost@test.com', 'nope-nope')).status).toBe(401);
  });

  it('signs in by email or by phone in any common spelling, and sets an httpOnly cookie', async () => {
    const byPhone = await login('0551112222', 'admin-pass-1');
    expect(byPhone.status).toBe(200);
    expect(byPhone.body.passwordHash).toBeUndefined();
    expect(byPhone.get('Set-Cookie')!.join(';')).toMatch(/access_token=.*HttpOnly/);
    expect((await login('+966 55 111 2222', 'admin-pass-1')).status).toBe(200);
  });

  it('requires a session for protected routes', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
    const me = await request(app.getHttpServer()).get('/auth/me').set('Cookie', adminCookie).expect(200);
    expect(me.body.role).toBe('ADMIN');
    await request(app.getHttpServer()).get('/health').expect(200);
  });

  describe('clients are scoped to their rep', () => {
    let repA: string[];
    let repB: string[];
    let clientOfA: string;

    beforeAll(async () => {
      for (const [email, name] of [['a@test.com', 'Rep A'], ['b@test.com', 'Rep B']]) {
        await request(app.getHttpServer())
          .post('/users')
          .set('Cookie', adminCookie)
          .send({ name, email, password: 'rep-pass-123', role: 'REP' })
          .expect(201);
      }
      repA = (await login('a@test.com', 'rep-pass-123')).get('Set-Cookie')!;
      repB = (await login('b@test.com', 'rep-pass-123')).get('Set-Cookie')!;
    });

    it('lets a rep create a client but not set its credit terms', async () => {
      const created = await request(app.getHttpServer())
        .post('/clients')
        .set('Cookie', repA)
        .send({ name: 'عميل أ', purchasingPhone: '0550000001' })
        .expect(201);
      clientOfA = created.body.id;
      expect(created.body.purchasingPhone).toBe('966550000001');

      await request(app.getHttpServer())
        .post('/clients')
        .set('Cookie', repA)
        .send({ name: 'عميل ب', creditLimit: 500000 })
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/clients/${clientOfA}`)
        .set('Cookie', repA)
        .send({ paymentTermsDays: 60 })
        .expect(403);
    });

    it('hides a client from other reps but not from the admin', async () => {
      await request(app.getHttpServer()).get(`/clients/${clientOfA}`).set('Cookie', repB).expect(404);
      await request(app.getHttpServer())
        .patch(`/clients/${clientOfA}`)
        .set('Cookie', repB)
        .send({ city: 'جدة' })
        .expect(404);
      const listB = await request(app.getHttpServer()).get('/clients').set('Cookie', repB).expect(200);
      expect(listB.body).toHaveLength(0);

      const updated = await request(app.getHttpServer())
        .patch(`/clients/${clientOfA}`)
        .set('Cookie', adminCookie)
        .send({ creditLimit: 750000, paymentTermsDays: 45 })
        .expect(200);
      expect(updated.body.creditLimit).toBe(750000);
    });

    it('keeps user management and catalogue edits admin-only', async () => {
      await request(app.getHttpServer()).get('/users').set('Cookie', repA).expect(403);
      await request(app.getHttpServer())
        .post('/brands')
        .set('Cookie', repA)
        .send({ name: 'راجحي' })
        .expect(403);
    });
  });

  it('builds the catalogue: product + brand + variant with unit and minimum quantity', async () => {
    const brand = await request(app.getHttpServer())
      .post('/brands').set('Cookie', adminCookie).send({ name: 'راجحي', nameEn: 'Al Rajhi' }).expect(201);
    const product = await request(app.getHttpServer())
      .post('/products').set('Cookie', adminCookie).send({ name: 'حديد تسليح', category: 'STEEL' }).expect(201);
    const body = { productId: product.body.id, brandId: brand.body.id, spec: '16 مم', unit: 'TON', minQty: 25 };
    const variant = await request(app.getHttpServer())
      .post('/variants').set('Cookie', adminCookie).send(body).expect(201);
    expect(variant.body).toMatchObject({ minQty: 25, unit: 'TON', brand: { name: 'راجحي' } });
    await request(app.getHttpServer()).post('/variants').set('Cookie', adminCookie).send(body).expect(409);

    // A product without a brand can exist once per size too.
    const noBrand = { productId: product.body.id, spec: '', unit: 'TON', minQty: 1 };
    await request(app.getHttpServer()).post('/variants').set('Cookie', adminCookie).send(noBrand).expect(201);
    await request(app.getHttpServer()).post('/variants').set('Cookie', adminCookie).send(noBrand).expect(409);
  });

  it('rejects unknown fields', async () => {
    await request(app.getHttpServer())
      .post('/clients')
      .set('Cookie', adminCookie)
      .send({ name: 'x', hacked: true })
      .expect(400);
  });
});
