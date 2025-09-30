import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';

const cookieExtractor = (req: Request): string | null =>
  req?.cookies?.['refresh_token'] ?? null;

@Injectable()
export class RefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(cfg: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor]),
      ignoreExpiration: false,
      secretOrKey: cfg.get<string>('JWT_REFRESH_SECRET')!,
      passReqToCallback: true,
    });
  }

  // devolvemos también el token crudo para rotación
  async validate(req: Request, payload: any) {
    return { ...payload, token: req?.cookies?.['refresh_token'] ?? null };
  }
}
