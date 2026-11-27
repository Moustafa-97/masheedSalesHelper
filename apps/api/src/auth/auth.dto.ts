import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  /** Email or phone number. */
  @IsString()
  @MaxLength(255)
  identifier: string;

  @IsString()
  @MaxLength(200)
  password: string;
}

export class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) jobTitle?: string;
  @IsOptional() @IsIn(['ar', 'en']) locale?: 'ar' | 'en';
  @IsOptional() @IsString() @MaxLength(120) supplyContactName?: string;
  @IsOptional() @IsString() @MaxLength(32) supplyContactPhone?: string;
}

export class ChangePasswordDto {
  @IsString() currentPassword: string;
  @IsString() @MinLength(8) @MaxLength(200) newPassword: string;
}
