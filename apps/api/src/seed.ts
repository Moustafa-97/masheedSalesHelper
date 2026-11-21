/**
 * npm run seed        -> runs migrations and creates the first admin (from ADMIN_* in .env) if none exists.
 * npm run seed:demo   -> also adds demo brands, products and clients (fictional) for local development.
 */
import 'dotenv/config';
import { DataSource, IsNull } from 'typeorm';
import { hashPassword, normalizePhone } from './auth/password.js';
import { Client, ClientStatus } from './clients/client.entity.js';
import { databaseOptions, migrationUrl } from './database/options.js';
import { Brand, Product, ProductVariant, Unit } from './products/product.entities.js';
import { Role, User } from './users/user.entity.js';

const demo = process.argv.includes('--demo');
const ds = new DataSource(databaseOptions(migrationUrl()));
await ds.initialize();
await ds.runMigrations();

const users = ds.getRepository(User);
let admin = await users.findOneBy({ role: Role.ADMIN });
if (!admin) {
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 8)
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (8+ chars) in .env');
  admin = await users.save(
    users.create({
      name: process.env.ADMIN_NAME ?? 'Admin',
      email,
      phone: process.env.ADMIN_PHONE ? normalizePhone(process.env.ADMIN_PHONE) : null,
      jobTitle: process.env.ADMIN_JOB_TITLE ?? 'Technical Sales Engineer',
      passwordHash: await hashPassword(password),
      role: Role.ADMIN,
    }),
  );
  console.log(`Created admin ${email}`);
} else {
  console.log(`Admin already exists: ${admin.email ?? admin.phone}`);
}

if (demo) {
  const brands = ds.getRepository(Brand);
  const products = ds.getRepository(Product);
  const variants = ds.getRepository(ProductVariant);
  const clients = ds.getRepository(Client);

  const brand = async (name: string, nameEn: string) =>
    (await brands.findOneBy({ name })) ?? brands.save(brands.create({ name, nameEn }));
  const product = async (name: string, nameEn: string, category: string) =>
    (await products.findOneBy({ name })) ?? products.save(products.create({ name, nameEn, category }));

  const rajhi = await brand('راجحي', 'Al Rajhi');
  const sabic = await brand('سابك', 'SABIC');
  const yamama = await brand('اليمامة', 'Yamama');
  const steel = await product('حديد تسليح', 'Rebar', 'STEEL');
  const cement = await product('أسمنت تشطيب', 'Finishing cement', 'CEMENT');
  const sand = await product('رمل', 'Sand', 'SAND');

  const variant = async (p: Product, b: Brand | null, spec: string, unit: Unit, minQty: number) => {
    const exists = await variants.findOneBy({ productId: p.id, brandId: b ? b.id : IsNull(), spec });
    if (!exists) await variants.save(variants.create({ productId: p.id, brandId: b?.id ?? null, spec, unit, minQty }));
  };
  for (const size of ['12 مم', '16 مم']) {
    await variant(steel, rajhi, size, Unit.TON, 25);
    await variant(steel, sabic, size, Unit.TON, 25);
  }
  await variant(cement, yamama, '', Unit.BAG, 500);
  await variant(sand, null, '', Unit.M3, 20);

  const client = async (name: string, data: Partial<Client>) =>
    (await clients.findOneBy({ name })) ??
    clients.save(clients.create({ name, repId: admin!.id, ...data }));
  await client('شركة الصرح للمقاولات (تجريبي)', {
    code: 'DEMO-001', city: 'الرياض', paymentTermsDays: 60, creditLimit: 1_500_000,
    openingBalance: 1_350_000, status: ClientStatus.ACTIVE,
  });
  await client('الواحة التجارية (تجريبي)', {
    code: 'DEMO-002', city: 'الرياض', paymentTermsDays: 30, creditLimit: 1_000_000,
    openingBalance: 760_000, status: ClientStatus.ACTIVE,
  });
  await client('مؤسسة الأفق للمقاولات (تجريبي)', { city: 'الرياض', status: ClientStatus.PROSPECT });
  console.log('Demo data ready');
}

await ds.destroy();
