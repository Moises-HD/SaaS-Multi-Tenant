import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { Role } from '@prisma/client';

const order: Role[] = ['VIEWER','MEMBER','ADMIN','OWNER'];

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest() as any;
    const userRole: Role | undefined = req.user?.role; // la pondremos en payload
    if (!userRole) return false;

    // si cualquier requerido está <= nivel del usuario, pasa
    return required.some(r => order.indexOf(userRole) >= order.indexOf(r));
  }
}
