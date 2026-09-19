import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export enum HistoryStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum DepositHistorySource {
  VIETQR = 'VIETQR',
}

export class HistoryQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsEnum(HistoryStatus) status?: HistoryStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}

export class NftHistoryQueryDto extends HistoryQueryDto {
  @IsOptional() @IsString() project_id?: string;
}

export class DepositHistoryQueryDto extends HistoryQueryDto {
  @IsOptional() @IsEnum(DepositHistorySource) source?: DepositHistorySource;
}
