/**
 * npm run seed        -> runs migrations and creates the first admin (from ADMIN_* in .env) if none exists.
 * npm run seed:demo   -> also adds demo clients (fictional) for local development.
 *                         Products come from the ERP export: Products page -> Import products file.
 */
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { hashPassword, normalizePhone } from './auth/password.js';
import { Client, ClientStatus } from './clients/client.entity.js';
import { databaseOptions, migrationUrl } from './database/options.js';
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
  const clients = ds.getRepository(Client);

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
