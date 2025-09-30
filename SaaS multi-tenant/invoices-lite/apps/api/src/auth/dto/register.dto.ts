import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail() email!: string;

  @IsString() @MinLength(8) @MaxLength(72)
  // al menos 8 chars; en prod añade requisitos si quieres
  password!: string;

  @IsString() @IsNotEmpty()
  tenantName!: string;

  @IsString() @Matches(/^[a-z0-9-]+$/)
  slug!: string;
}
