import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length, Matches, MinLength } from 'class-validator';

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const trimText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class LoginDto {
  @Transform(normalizeEmail) @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsOptional() @IsBoolean() remember_me?: boolean;
  @IsOptional() @IsString() fcm_token?: string;
  @IsOptional() @IsString() device_info?: string;
  @IsOptional() @IsIn(['mobile', 'desktop', 'tablet', 'unknown']) device_type?: string;
  @IsOptional() @IsString() device_location?: string;
}

export class RegisterDto extends LoginDto {
  @Transform(trimText) @IsString() @MinLength(2) full_name!: string;
  @IsString() @MinLength(8) confirm_password!: string;
  @IsBoolean() @Equals(true, { message: 'Bạn cần đồng ý Điều khoản sử dụng và Chính sách bảo mật' }) accept_terms!: boolean;
  @IsOptional() @Transform(trimText) @IsString() @MinLength(2) nickname?: string;
  @IsOptional() @Transform(trimText) @IsString() ref_by?: string;
}

export class EmailDto {
  @Transform(normalizeEmail) @IsEmail() email!: string;
}

export class VerifyOtpDto extends EmailDto {
  @IsString() @Length(6, 6) @Matches(/^\d{6}$/, { message: 'OTP phải gồm đúng 6 chữ số' }) otp!: string;
}

export class ResetPasswordDto {
  @IsString() reset_token!: string;
  @IsString() @MinLength(8) new_password!: string;
  @IsString() @MinLength(8) confirm_password!: string;
}

export class ChangePasswordDto {
  @IsString() @MinLength(8) password!: string;
  @IsString() @MinLength(8) old_password!: string;
}

export class RefreshDto {
  @IsString() refresh_token!: string;
  @IsOptional() @IsString() access_token?: string;
}
