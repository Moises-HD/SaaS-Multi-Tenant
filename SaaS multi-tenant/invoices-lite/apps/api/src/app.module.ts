import { Module, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma.service';
import { InvoicesModule } from './invoices/invoices.module';
import { CustomersModule } from './customers/customers.module';
import { RedisIoModule  } from './redis.module';
import { AuthModule } from './auth/auth.module';
import { TenantMiddleware } from './tenancy/tenant.middleware';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisIoModule ,
    AuthModule,
    InvoicesModule,
    CustomersModule,
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantMiddleware)
      .exclude(
        { path: 'auth/register', method: RequestMethod.POST },
        { path: 'auth/login',    method: RequestMethod.POST },
        { path: 'auth/refresh',  method: RequestMethod.POST },
        { path: 'auth/logout',   method: RequestMethod.POST },
        { path: 'health',        method: RequestMethod.GET },
        { path: '',              method: RequestMethod.GET },
      )
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
