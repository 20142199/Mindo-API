import { AgencyStatus, AiMessageKind, UserRole } from '@prisma/client';
import { IsArray, IsBoolean, IsEmail, IsEnum, IsHexColor, IsInt, IsNumber, IsOptional, IsString, IsUrl, Max, Min, MinLength } from 'class-validator';

export class CreateAgencyApplicationDto {
  @IsString() @MinLength(2) business_name!: string;
  @IsOptional() @IsString() tax_code?: string;
  @IsString() @MinLength(8) phone!: string;
  @IsString() @MinLength(5) address!: string;
  @IsOptional() @IsString() parent_code?: string;
}

export class UpdateAgencyStoreDto {
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsUrl({ require_tld: false }) logo_url?: string;
  @IsOptional() @IsUrl({ require_tld: false }) banner_url?: string;
  @IsOptional() @IsEmail() contact_email?: string;
  @IsOptional() @IsString() contact_phone?: string;
  @IsOptional() @IsHexColor() primary_color?: string;
}

export class BuyAgencyPackageDto {
  @IsOptional() @IsString() product_id?: string;
  @IsInt() @Min(1) @Max(10_000) quantity!: number;
}

export class UpdateAgencyPackageSettingDto {
  @IsNumber() @Min(1) @Max(1_000_000) usd_vnd_rate!: number;
}

export class ReviewAgencyDto {
  @IsEnum(AgencyStatus) status!: AgencyStatus;
  @IsOptional() @IsString() review_note?: string;
  @IsOptional() @IsString() rejection_reason?: string;
}

export class CreateAdminAccountDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(2) full_name!: string;
  @IsString() @MinLength(8) password!: string;
  @IsEnum(UserRole) role!: UserRole;
}

export class UpdateAdminRoleDto {
  @IsEnum(UserRole) role!: UserRole;
}

export class ResetAdminPasswordDto {
  @IsString() @MinLength(8) password!: string;
}

export class CreateAiConversationDto {
  @IsString() expert_id!: string;
  @IsOptional() @IsString() title?: string;
}

export class CreateAiMessageDto {
  @IsString() @MinLength(1) content!: string;
  @IsOptional() @IsEnum(AiMessageKind) kind?: AiMessageKind;
  @IsOptional() @IsString() target_language?: string;
  @IsOptional() @IsString() attachment_file_id?: string;
}

export class UpsertAiExpertDto {
  @IsString() @MinLength(2) name!: string;
  @IsString() @MinLength(2) slug!: string;
  @IsString() @MinLength(2) specialty!: string;
  @IsString() @MinLength(10) description!: string;
  @IsString() @MinLength(10) system_prompt!: string;
  @IsOptional() @IsUrl({ require_tld: false }) avatar_url?: string;
  @IsOptional() @IsArray() @IsEnum(AiMessageKind, { each: true }) capabilities?: AiMessageKind[];
  @IsOptional() @IsBoolean() is_active?: boolean;
}
