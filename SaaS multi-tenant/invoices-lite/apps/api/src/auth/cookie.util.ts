import { ConfigService } from '@nestjs/config';
import { Response } from 'express';

export function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
  cfg: ConfigService,
) {
  const domain   = cfg.get<string>('COOKIE_DOMAIN');
  const secure   = cfg.get<string>('COOKIE_SECURE') === 'true';
  const sameSite = (cfg.get<string>('COOKIE_SAMESITE') || 'lax') as 'lax'|'strict'|'none';
  const accessTtl  = parseInt(cfg.get<string>('JWT_ACCESS_TTL')  || '900',    10);
  const refreshTtl = parseInt(cfg.get<string>('JWT_REFRESH_TTL') || '604800', 10);

  res.cookie('access_token', tokens.accessToken, {
    httpOnly: true,
    secure,
    sameSite,
    domain,
    path: '/',                 
    maxAge: accessTtl * 1000,
  });

  res.cookie('refresh_token', tokens.refreshToken, {
    httpOnly: true,
    secure,
    sameSite,
    domain,
    path: '/',          
    maxAge: refreshTtl * 1000,
  });
}

export function clearAuthCookies(res: Response, cfg: ConfigService) {
  const domain   = cfg.get<string>('COOKIE_DOMAIN');
  const secure   = cfg.get<string>('COOKIE_SECURE') === 'true';
  const sameSite = (cfg.get<string>('COOKIE_SAMESITE') || 'lax') as 'lax'|'strict'|'none';

  res.clearCookie('access_token',  { httpOnly: true, secure, sameSite, domain, path: '/' });
  res.clearCookie('refresh_token', { httpOnly: true, secure, sameSite, domain, path: '/' });
}

