import { WithdrawalStatus } from '@prisma/client';
import { IsEnum, IsNumberString, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateWithdrawalDto {
  @IsNumberString() @Matches(/^[1-9]\d{0,19}$/, { message: 'Số tiền rút phải là số nguyên dương' }) amount_vnd!: string;
  @IsString() @MinLength(2) @MaxLength(100) bank_name!: string;
  @IsString() @Matches(/^\d{6,30}$/, { message: 'Số tài khoản ngân hàng không hợp lệ' }) bank_account_number!: string;
  @IsString() @MinLength(2) @MaxLength(100) bank_account_name!: string;
}

export class ApproveWithdrawalDto {
  @IsString() @MinLength(3) @MaxLength(100) transaction_code!: string;
  @IsString() @MinLength(1) transfer_proof_file_id!: string;
  @IsOptional() @IsString() @MaxLength(500) review_note?: string;
}

export class RejectWithdrawalDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class WithdrawalQueryDto {
  @IsOptional() @IsEnum(WithdrawalStatus) status?: WithdrawalStatus;
}
