import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';

const trimText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateProfileDto {
  @IsOptional() @Transform(trimText) @IsString() @MinLength(2) full_name?: string;
  @IsOptional() @Transform(trimText) @IsString()
  @Matches(/^[+()\-\s\d]{8,20}$/, { message: 'Số điện thoại không hợp lệ' })
  phone_number?: string;
  @IsOptional() @Transform(trimText) @IsString() @MinLength(5) address?: string;
  @IsOptional() @IsString() avatar_file_id?: string;
}

export class UpdateAccountSettingsDto {
  @IsOptional() @IsIn(['vi', 'en']) language?: 'vi' | 'en';
  @IsOptional() @IsBoolean() suspicious_login_alerts?: boolean;
  @IsOptional() @IsBoolean() login_rate_limit_enabled?: boolean;
  @IsOptional() @IsBoolean() in_app_notifications?: boolean;
  @IsOptional() @IsBoolean() email_notifications?: boolean;
}
