// src/invoices/invoices.controller.ts
import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards, Req, BadRequestException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { TenantId } from '../tenancy/tenant-id.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly service: InvoicesService) {}

  @Get()
  @Roles('VIEWER')
  list(@TenantId() tenantId: string, @Req() req: any) {
    const tId = tenantId ?? req?.user?.tenantId;
    if (!tId) throw new BadRequestException('Missing tenant context');
    return this.service.list(tId);
  }

  @Get(':id')
  @Roles('VIEWER')
  get(@Param('id') id: string, @TenantId() tenantId: string, @Req() req: any) {
    const tId = tenantId ?? req?.user?.tenantId;
    if (!tId) throw new BadRequestException('Missing tenant context');
    return this.service.getById(tId, id);
  }

  @Post()
  @Roles('MEMBER')
  create(@Body() dto: CreateInvoiceDto, @TenantId() tenantId: string, @Req() req: any) {
    const tId = tenantId ?? req?.user?.tenantId;
    if (!tId) throw new BadRequestException('Missing tenant context');
    return this.service.create(tId, dto);
  }

  @Put(':id')
  @Roles('MEMBER')
  update(@Param('id') id: string, @Body() dto: UpdateInvoiceDto, @TenantId() tenantId: string, @Req() req: any) {
    const tId = tenantId ?? req?.user?.tenantId;
    if (!tId) throw new BadRequestException('Missing tenant context');
    return this.service.update(tId, id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string, @TenantId() tenantId: string, @Req() req: any) {
    const tId = tenantId ?? req?.user?.tenantId;
    if (!tId) throw new BadRequestException('Missing tenant context');
    return this.service.remove(tId, id);
  }
}
