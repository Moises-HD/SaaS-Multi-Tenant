import { Controller, Get, Post, Put, Delete, Body, Param, Req, UseGuards } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { BadRequestException } from '@nestjs/common';

@Controller('customers')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  private resolveTenant(req: any): string {
    const tid = req.tenantId ?? req.user?.tenantId;
    if (!tid) throw new BadRequestException('Tenant not resolved');
    return tid;
  }

  @Get()
  findAll(@Req() req: any) {
    return this.service.list(this.resolveTenant(req));
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.service.getById(this.resolveTenant(req), id);
  }

  @Post()
  @Roles('OWNER', 'ADMIN')
  create(@Req() req: any, @Body() dto: CreateCustomerDto) {
    return this.service.create(this.resolveTenant(req), dto);
  }

  @Put(':id')
  @Roles('OWNER', 'ADMIN')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.service.update(this.resolveTenant(req), id, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.service.remove(this.resolveTenant(req), id);
  }
}