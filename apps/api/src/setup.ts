import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';

/** Shared by main.ts and the e2e tests so both run the same pipeline. */
export function configureApp(app: INestApplication) {
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  const origins = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',');
  app.enableCors({ origin: origins, credentials: true });
  app.enableShutdownHooks();
  return app;
}
