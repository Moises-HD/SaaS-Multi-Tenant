// src/invoices/invoices.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';

@Injectable()
export class InvoicesService {
  constructor(private prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.invoice.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  getById(tenantId: string, id: string) {
    return this.prisma.invoice.findFirst({ where: { id, tenantId } });
  }

  async create(tenantId: string, dto: CreateInvoiceDto) {
    if (!tenantId) throw new BadRequestException('Missing tenantId');
    return this.prisma.invoice.create({
      data: {
        tenantId, 
        customerId: dto.customerId,
        number: dto.number,
        amount: dto.amount,
        currency: dto.currency ?? 'EUR',
        issueDate: new Date(dto.issueDate), 
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        status: dto.status ?? 'DRAFT',
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateInvoiceDto) {
    const exists = await this.getById(tenantId, id);
    if (!exists) throw new NotFoundException('Invoice not found');

    return this.prisma.invoice.update({
      where: { id },
      data: {
        customerId: dto.customerId,
        number: dto.number,
        amount: dto.amount,
        currency: dto.currency,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined,
        dueDate: dto.dueDate === undefined ? undefined : (dto.dueDate ? new Date(dto.dueDate) : null),
        status: dto.status,
      },
    });
  }

  async remove(tenantId: string, id: string) {
    const exists = await this.getById(tenantId, id);
    if (!exists) throw new NotFoundException('Invoice not found');
    await this.prisma.invoice.delete({ where: { id } });
    return { ok: true };
  }
}
