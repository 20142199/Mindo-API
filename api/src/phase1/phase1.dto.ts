import { ArticleStatus, ReviewStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsEnum, IsIn, IsInt, IsNumber, IsNumberString, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateKycDto {
  @IsString() @MinLength(2) full_name!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() date_of_birth?: string | number;
  @IsOptional() @IsString() @MinLength(6) id_card_number?: string;
  @IsString() @MinLength(8) phone_number!: string;
  @IsString() @MinLength(5) address!: string;
  @IsString() @MinLength(2) bank_account_name!: string;
  @IsString() @Matches(/^\d{6,30}$/, { message: 'Số tài khoản ngân hàng không hợp lệ' }) bank_account_number!: string;
  @IsString() @MinLength(2) bank_name!: string;
  @IsOptional() @IsString() id_front_file_url?: string;
  @IsOptional() @IsString() id_back_file_url?: string;
  @IsOptional() @IsString() selfie_file_url?: string;
  @IsOptional() @IsString() id_front_file_id?: string;
  @IsOptional() @IsString() id_back_file_id?: string;
  @IsOptional() @IsString() selfie_file_id?: string;
}

export class ReviewDto {
  @IsEnum(ReviewStatus) status!: ReviewStatus;
  @IsOptional() @IsString() review_note?: string;
  @IsOptional() @IsString() rejection_reason?: string;
}

export class CreateDepositDto {
  @IsNumberString() amount_vnd!: string;
  @IsOptional() @IsUrl({ require_tld: false }) proof_file_url?: string;
}

export class VietQrCallbackDto {
  @IsString() bankaccount!: string;
  @IsNumber() @Min(1) amount!: number;
  @IsString() transType!: string;
  @IsString() content!: string;
  @IsString() transactionid!: string;
  @IsOptional() @IsNumber() transactiontime?: number;
  @IsOptional() @IsString() referencenumber?: string;
  @IsOptional() @IsString() orderId?: string;
  @IsOptional() @IsString() terminalCode?: string;
  @IsOptional() @IsString() subTerminalCode?: string;
  @IsOptional() @IsString() serviceCode?: string;
  @IsOptional() @IsString() urlLink?: string;
  @IsOptional() @IsString() sign?: string;
}

export class CreateNftProductDto {
  @IsString() @MinLength(2) name!: string;
  @IsString() @MinLength(2) symbol!: string;
  @IsString() description!: string;
  @IsUrl({ require_tld: false }) image_url!: string;
  @IsUrl({ require_tld: false }) metadata_base_url!: string;
  @IsNumberString() unit_price_vnd!: string;
  @IsInt() @Min(1) total_supply!: number;
}

export class UpdateNftProductDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() @MinLength(2) symbol?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsUrl({ require_tld: false }) image_url?: string;
  @IsOptional() @IsUrl({ require_tld: false }) metadata_base_url?: string;
  @IsOptional() @IsNumberString() unit_price_vnd?: string;
  @IsOptional() @IsInt() @Min(1) total_supply?: number;
  @IsOptional() @IsBoolean() is_active?: boolean;
}

export class CalculatePriceDto {
  @IsInt() @Min(1) @Max(500) amount!: number;
  @IsString() project_id!: string;
  @IsOptional() @IsString() @MaxLength(64) referral_code?: string;
}

export class SnapshotPriceDto {
  @IsInt() @Min(1) @Max(500) amount!: number;
  @IsString() nft_id!: string;
  @IsString() @IsIn(['BALANCE', 'balance']) payment_type!: string;
  @IsOptional() @IsString() @MaxLength(64) referral_code?: string;
}

export class InvestDto {
  @IsString() price_snapshot!: string;
  @IsOptional() @IsString() @MaxLength(64) agency_code?: string;
  @IsOptional() @IsString() @MaxLength(64) referral_code?: string;
}

export class MyNftQueryDto {
  @IsOptional() @IsString() project_id?: string;
  @IsOptional() @IsString() @MaxLength(120) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class CreateArticleDto {
  @IsString() @MinLength(5) title!: string;
  @IsString() @MinLength(3) slug!: string;
  @IsString() summary!: string;
  @IsString() @MinLength(20) content!: string;
  @IsOptional() @IsUrl({ require_tld: false }) image_url?: string;
  @IsOptional() @IsUrl() source_url?: string;
  @IsOptional() @IsEnum(ArticleStatus) status?: ArticleStatus;
}
