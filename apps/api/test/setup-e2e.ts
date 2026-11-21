import { DataSource } from 'typeorm';

// Each e2e run starts from an empty schema in the test database.
process.env.DATABASE_URL ??= 'postgres://sales:sales@localhost:5432/sales_test';
process.env.JWT_SECRET ??= 'test-secret-that-is-at-least-32-bytes-long!!';
process.env.BCRYPT_ROUNDS = '4';

const ds = new DataSource({ type: 'postgres', url: process.env.DATABASE_URL });
await ds.initialize();
await ds.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await ds.destroy();
