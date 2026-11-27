import type { DataSourceOptions } from 'typeorm';
import { Client } from '../clients/client.entity.js';
import { migrations } from '../migrations/index.js';
import {
  ClientGuarantee,
  ClientProject,
  Delivery,
  DeliveryLine,
  Order,
  OrderDocument,
  OrderEvent,
  OrderLine,
  Payment,
  SalesInvoice,
  StoredFile,
} from '../orders/order.entities.js';
import { Brand, Product, ProductVariant, VariantZone } from '../products/product.entities.js';
import { User } from '../users/user.entity.js';

export const entities = [
  User,
  Client,
  Brand,
  Product,
  ProductVariant,
  VariantZone,
  StoredFile,
  ClientProject,
  Order,
  OrderLine,
  OrderDocument,
  Delivery,
  DeliveryLine,
  SalesInvoice,
  Payment,
  OrderEvent,
  ClientGuarantee,
];

/**
 * Connection string for schema work (migrations, seed, TypeORM CLI).
 * Neon gives a pooled URL (DATABASE_URL, via PgBouncer) and a direct one
 * (DATABASE_URL_UNPOOLED); DDL is safest on the direct connection.
 */
export function migrationUrl(env = process.env): string | undefined {
  return env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
}

/**
 * When the URL carries sslmode (Neon's does), it decides SSL and the server
 * certificate is verified. `require` is spelled `verify-full` so node-postgres
 * does not print its alias warning; the behaviour is the same.
 * Without sslmode, DATABASE_SSL=true turns on SSL without verification
 * (for hosts with self-signed certificates).
 */
export function connectionSettings(
  url: string,
  sslFlag = process.env.DATABASE_SSL,
): { url: string; ssl?: { rejectUnauthorized: boolean } } {
  if (/[?&]sslmode=/i.test(url)) {
    return { url: url.replace(/([?&]sslmode=)(require|prefer|verify-ca)\b/i, '$1verify-full') };
  }
  return { url, ssl: sslFlag === 'true' ? { rejectUnauthorized: false } : undefined };
}

/** Shared by the Nest app, the seed script and the TypeORM CLI. */
export function databaseOptions(url = process.env.DATABASE_URL): DataSourceOptions {
  if (!url) throw new Error('DATABASE_URL is not set');
  return {
    type: 'postgres',
    ...connectionSettings(url),
    entities,
    migrations,
    synchronize: false,
    // gen_random_uuid() is built into PostgreSQL 13+, no extension needed.
    uuidExtension: 'pgcrypto',
    extra: {
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      // A free Neon database sleeps when idle; the first connection wakes it.
      connectionTimeoutMillis: 15_000,
    },
  };
}
