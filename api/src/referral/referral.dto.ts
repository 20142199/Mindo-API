import { ReferralCommissionType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class UpdateReferralSettingsDto {
  @IsNumber() @Min(0) @Max(100) direct_rate_percent!: number;
  @IsNumber() @Min(0) @Max(100) branch_rate_percent!: number;
}

export class CreateSystemReferralCodeDto {
  @IsOptional() @IsString() @MinLength(2) label?: string;
}

export class UpdateSystemReferralCodeDto {
  @IsBoolean() is_active!: boolean;
}

export class ReferralPeriodQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}

export class ReferralCommissionQueryDto extends ReferralPeriodQueryDto {
  @IsOptional() @IsEnum(ReferralCommissionType) type?: ReferralCommissionType;
}
