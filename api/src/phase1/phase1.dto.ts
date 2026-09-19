import { ArticleStatus, ReviewStatus } from '@prisma/client';
import { IsEmail, IsEnum, IsInt, IsNumber, IsNumberString, IsOptional, IsString, IsUrl, Matches, Max, Min, MinLength } from 'class-validator';

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

export class DepositReviewDto {
  @IsOptional() @IsString() review_note?: string;
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

export class CalculatePriceDto {
  @IsInt() @Min(1) @Max(500) amount!: number;
  @IsString() project_id!: string;
}

export class SnapshotPriceDto {
  @IsInt() @Min(1) @Max(500) amount!: number;
  @IsString() nft_id!: string;
  @IsString() payment_type!: string;
}

export class InvestDto {
  @IsString() price_snapshot!: string;
  @IsOptional() @IsString() agency_code?: string;
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
