import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { Role } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private cfg: ConfigService,
    @InjectRedis() private readonly redis: Redis, // 👈 cliente ioredis inyectado
  ) {}

  private async hash(pw: string) {
    return bcrypt.hash(pw, 12);
  }

  private async compare(pw: string, hash: string) {
    return bcrypt.compare(pw, hash);
  }

  async register(dto: RegisterDto) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new BadRequestException('Email already in use');

    const passwordHash = await this.hash(dto.password);
    const user = await this.prisma.user.create({
      data: { email: dto.email, passwordHash, name: dto.email.split('@')[0] },
    });

    const tenant = await this.prisma.tenant.create({
      data: { name: dto.tenantName, slug: dto.slug },
    });

    await this.prisma.membership.create({
      data: { userId: user.id, tenantId: tenant.id, role: 'OWNER' },
    });

    // emite tokens para ese tenant con rol OWNER
    const tokens = await this.issueTokens(user.id, user.email, tenant.id, 'OWNER');
    return { user, tenant, ...tokens };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await this.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    // Para demo: usa el primer membership como tenant actual
    const m = await this.prisma.membership.findFirst({ where: { userId: user.id } });
    if (!m) throw new UnauthorizedException('No memberships');

    const tokens = await this.issueTokens(user.id, user.email, m.tenantId, m.role);
    return { userId: user.id, tenantId: m.tenantId, role: m.role, ...tokens };
  }

  private async issueTokens(userId: string, email: string, tenantId: string, role: Role) {
    const accessTtl = parseInt(this.cfg.get<string>('JWT_ACCESS_TTL') || '900', 10);
    const refreshTtl = parseInt(this.cfg.get<string>('JWT_REFRESH_TTL') || '604800', 10);

    const accessPayload = { sub: userId, email, tenantId, role, typ: 'access' };
    const refreshJti = randomUUID();
    const refreshPayload = { sub: userId, email, tenantId, typ: 'refresh', jti: refreshJti };

    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.cfg.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: accessTtl,
    });

    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: this.cfg.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: refreshTtl,
    });

    // Allow-list en Redis para refresh (rotación)
    await this.redis.set(`rt:${refreshJti}`, userId, 'EX', refreshTtl);

    return { accessToken, refreshToken };
  }

  async rotate(_oldToken: string, payload: any) {
    const jti = payload?.jti as string | undefined;
    if (!jti) throw new UnauthorizedException('Invalid token');

    const exists = await this.redis.get(`rt:${jti}`);
    if (!exists) throw new UnauthorizedException('Refresh token revoked');

    // revoca el antiguo
    await this.redis.del(`rt:${jti}`);

    const { sub, email, tenantId } = payload;
    const role = (payload as any).role || 'MEMBER'; 
    return this.issueTokens(sub, email, tenantId, role);
  }

  async logout(refreshPayload: any) {
    const jti = refreshPayload?.jti as string | undefined;
    if (jti) {
      await this.redis.del(`rt:${jti}`);
    }
    return { ok: true };
  }
}
