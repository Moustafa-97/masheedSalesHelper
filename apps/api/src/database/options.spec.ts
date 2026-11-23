import { connectionSettings, migrationUrl } from './options.js';

const neon =
  'postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

describe('connectionSettings', () => {
  it('lets a Neon URL decide SSL, with certificate verification', () => {
    const s = connectionSettings(neon, 'false');
    expect(s.ssl).toBeUndefined();
    expect(s.url).toContain('sslmode=verify-full');
    expect(s.url).toContain('channel_binding=require');
  });
  it('uses DATABASE_SSL when the URL has no sslmode', () => {
    expect(connectionSettings('postgres://a@h/db', 'true').ssl).toEqual({ rejectUnauthorized: false });
    expect(connectionSettings('postgres://a@h/db', undefined).ssl).toBeUndefined();
  });
});

describe('migrationUrl', () => {
  it('prefers the direct (unpooled) URL', () => {
    expect(migrationUrl({ DATABASE_URL: 'pooled', DATABASE_URL_UNPOOLED: 'direct' })).toBe('direct');
    expect(migrationUrl({ DATABASE_URL: 'pooled' })).toBe('pooled');
  });
});
