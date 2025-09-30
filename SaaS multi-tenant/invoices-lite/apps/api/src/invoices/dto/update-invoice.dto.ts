import { PartialType } from '@nestjs/mapped-types';
import { CreateInvoiceDto } from './create-invoice.dto';
import { IsEnum, IsISO8601, IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateInvoiceDto extends PartialType(CreateInvoiceDto) {
  @IsOptional()
  @IsString()
  customerId?: string;   

  @IsOptional() @IsString() number?: string;
  @IsOptional() @IsNumber() amount?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsISO8601() issueDate?: string;
  @IsOptional() @IsISO8601() dueDate?: string | null;
  @IsOptional() @IsEnum(['DRAFT','SENT','PAID','VOID']) status?: 'DRAFT'|'SENT'|'PAID'|'VOID';
}
