import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.customer.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(tenantId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId }, // filtra en la query, no después
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  create(tenantId: string, dto: CreateCustomerDto) {
    return this.prisma.customer.create({
      data: { tenantId, name: dto.name, email: dto.email },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateCustomerDto) {
    const r = await this.prisma.customer.updateMany({
      where: { id, tenantId },       // nunca tocar otro tenant
      data: { name: dto.name, email: dto.email },
    });
    if (r.count === 0) throw new NotFoundException('Customer not found');
    return this.getById(tenantId, id);
  }

  async remove(tenantId: string, id: string) {
    const r = await this.prisma.customer.deleteMany({
      where: { id, tenantId },      
    });
    if (r.count === 0) throw new NotFoundException('Customer not found');
    return { ok: true };
  }
}
