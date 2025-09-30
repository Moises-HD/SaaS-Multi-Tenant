import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCustomerDto {
  @IsString() @MaxLength(120)
  name!: string;

  @IsOptional() @IsEmail()
  email?: string;
}
