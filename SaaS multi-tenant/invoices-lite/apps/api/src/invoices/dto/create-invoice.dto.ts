import { IsEnum, IsISO8601, IsNumber, IsOptional, IsString } from 'class-validator';

export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PAID' | 'VOID';

export class CreateInvoiceDto {
  @IsString()               
  customerId!: string;

  @IsString()
  number!: string;

  @IsNumber()
  amount!: number;

  @IsString()
  currency!: string;

  @IsISO8601()
  issueDate!: string;

  @IsOptional()
  @IsISO8601()
  dueDate?: string | null;

  @IsEnum(['DRAFT','SENT','PAID','VOID'])
  status!: InvoiceStatus;
}
