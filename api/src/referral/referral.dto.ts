import { IsBoolean, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

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

