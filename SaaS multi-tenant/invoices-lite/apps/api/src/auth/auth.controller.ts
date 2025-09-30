import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { setAuthCookies, clearAuthCookies } from './cookie.util';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';

// Importa SOLO tipos desde express
import type { Response, Request } from 'express';

@Controller('auth')
export class AuthController {
  constructor(
    private service: AuthService,
    private jwt: JwtService,
    private cfg: ConfigService,
  ) {}

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response, 
  ) {
    const { accessToken, refreshToken, user, tenant } = await this.service.register(dto);
    setAuthCookies(res, { accessToken, refreshToken }, this.cfg);
    return { ok: true, user: { id: user.id, email: user.email }, tenant };
  }

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken, userId, tenantId, role } = await this.service.login(dto);
    setAuthCookies(res, { accessToken, refreshToken }, this.cfg);
    return { ok: true, userId, tenantId, role };
  }

  @Post('refresh')
  @UseGuards(AuthGuard('jwt-refresh'))
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.service.rotate((req as any).user.token, (req as any).user);
    setAuthCookies(res, tokens, this.cfg);
    return { ok: true };
  }

  @Post('logout')
  @UseGuards(AuthGuard('jwt-refresh'))
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.service.logout((req as any).user);
    clearAuthCookies(res, this.cfg);
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  me(@Req() req: Request) {
    return { user: (req as any).user };
  }
}
