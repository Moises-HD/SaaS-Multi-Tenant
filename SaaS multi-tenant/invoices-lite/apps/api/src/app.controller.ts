import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('/')
  root() {
    return { ok: true, service: 'api', time: new Date().toISOString() };
  }

  @Get('/health')
  health() {
    return { status: 'up' };
  }
}
