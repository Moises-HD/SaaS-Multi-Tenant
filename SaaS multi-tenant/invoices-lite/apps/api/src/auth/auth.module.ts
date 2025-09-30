import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PrismaService } from '../prisma.service';
import { AccessStrategy } from './strategies/access.strategy';
import { RefreshStrategy } from './strategies/refresh.strategy';

@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}), // usaremos secrets desde Config en runtime
  ],
  controllers: [AuthController],
  providers: [AuthService, PrismaService, AccessStrategy, RefreshStrategy],
  exports: [],
})
export class AuthModule {}
