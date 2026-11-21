// Used by the TypeORM CLI (npm run migration:generate / migration:run) after `npm run build`.
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { databaseOptions, migrationUrl } from './options.js';

export default new DataSource(databaseOptions(migrationUrl()));
