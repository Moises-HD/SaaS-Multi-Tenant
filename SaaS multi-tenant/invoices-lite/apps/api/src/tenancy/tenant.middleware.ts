// apps/api/src/tenancy/tenant.middleware.ts
import type { Request, Response, NextFunction } from 'express';
import { NotFoundException } from '@nestjs/common';

export function TenantMiddleware(req: Request, _res: Response, next: NextFunction) {
  const forcedSlug = (req.headers['x-tenant'] as string)?.trim();
  const fwdHost    = (req.headers['x-forwarded-host'] as string)?.trim();
  const realHost   = (req.headers.host || '').trim();
  const querySlug  = (req.query?.tenant as string)?.trim();

  const hostForSplit = (forcedSlug ? `${forcedSlug}.dummy` : (fwdHost || realHost)).split(':')[0];
  const slug = forcedSlug ?? hostForSplit.split('.')[0];
  const finalSlug = querySlug || slug;

  if (!finalSlug) return next(new NotFoundException('Tenant not resolved'));

  (req as any).tenantSlug = finalSlug;

  next();
}
