// Used by the TypeORM CLI (npm run migration:generate / migration:run) after `npm run build`.
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { databaseOptions } from './options.js';

export default new DataSource(databaseOptions());
