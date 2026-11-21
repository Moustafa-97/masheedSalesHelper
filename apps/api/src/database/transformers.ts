import type { ValueTransformer } from 'typeorm';

/**
 * PostgreSQL returns numeric/decimal columns as strings.
 * Amounts in this app stay well below 2^53, so converting to number is safe
 * and keeps the API responses simple for the web app.
 */
export const numericTransformer: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) =>
    value === null || value === undefined ? value : Number(value),
};
