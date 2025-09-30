import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';

// extractor de cookie bien tipado
const cookieExtractor = (req: Request): string | null =>
  req?.cookies?.['access_token'] ?? null;

@Injectable()
export class AccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(cfg: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor]),
      ignoreExpiration: false,
      // ¡Nunca indefinido! usa ConfigService y asume string
      secretOrKey: cfg.get<string>('JWT_ACCESS_SECRET')!,
    });
  }

  async validate(payload: any) {
    // payload: { sub, email, tenantId, role, typ: 'access' }
    return payload;
  }
}
