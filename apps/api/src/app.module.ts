import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module.js';
import { ClientsModule } from './clients/clients.module.js';
import { Public } from './common/auth.decorators.js';
import { databaseOptions } from './database/options.js';
import { ProductsModule } from './products/products.module.js';
import { UsersModule } from './users/users.module.js';

@Controller('health')
class HealthController {
  @Public()
  @Get()
  health() {
    return { ok: true };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        ...databaseOptions(),
        // Apply pending migrations at startup.
        migrationsRun: process.env.MIGRATIONS_RUN !== 'false',
      }),
    }),
    AuthModule,
    UsersModule,
    ClientsModule,
    ProductsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
