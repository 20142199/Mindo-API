import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

const trimText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export enum FriendRequestDirection {
  INCOMING = 'incoming',
  OUTGOING = 'outgoing',
}

export class SendFriendRequestDto {
  @Transform(trimText)
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  identifier!: string;
}

export class FriendListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
  @IsOptional() @Transform(trimText) @IsString() @MaxLength(100) q?: string;
}

export class FriendRequestQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
  @IsOptional() @IsEnum(FriendRequestDirection) direction?: FriendRequestDirection;
}
