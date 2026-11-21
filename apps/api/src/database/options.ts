import type { DataSourceOptions } from 'typeorm';
import { Client } from '../clients/client.entity.js';
import { migrations } from '../migrations/index.js';
import { Brand, Product, ProductVariant } from '../products/product.entities.js';
import { User } from '../users/user.entity.js';

export const entities = [User, Client, Brand, Product, ProductVariant];

/** Shared by the Nest app and the TypeORM CLI (src/database/data-source.ts). */
export function databaseOptions(url = process.env.DATABASE_URL): DataSourceOptions {
  if (!url) throw new Error('DATABASE_URL is not set');
  return {
    type: 'postgres',
    url,
    entities,
    migrations,
    synchronize: false,
    // gen_random_uuid() is built into PostgreSQL 13+, no extension needed.
    uuidExtension: 'pgcrypto',
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  };
}
