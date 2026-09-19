import { Type } from 'class-transformer';
import { CallStatus, CallType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export enum CallClient {
  APP = 'app',
  WEB = 'web',
}

export enum CallDirection {
  INCOMING = 'incoming',
  OUTGOING = 'outgoing',
}

export enum CallEndReason {
  NETWORK_LOST = 'network_lost',
  PEER_NETWORK_LOST = 'peer_network_lost',
  RTC_DISCONNECT = 'rtc_disconnect',
}

export class InitiateCallDto {
  @IsString() callee_user_id!: string;
  @IsEnum(CallType) call_type!: CallType;
  @IsOptional() @IsString() conversation_id?: string;
  @IsOptional() @IsEnum(CallClient) client_platform: CallClient = CallClient.APP;
}

export class CallClientDto {
  @IsOptional() @IsEnum(CallClient) client_platform: CallClient = CallClient.APP;
}

export class EndCallDto {
  @IsOptional() @IsEnum(CallEndReason) reason?: CallEndReason;
}

export class CallTokenQueryDto {
  @IsOptional() @IsEnum(CallClient) client: CallClient = CallClient.APP;
}

export class CallHistoryQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
  @IsOptional() @IsEnum(CallStatus) status?: CallStatus;
  @IsOptional() @IsEnum(CallType) call_type?: CallType;
  @IsOptional() @IsEnum(CallDirection) direction?: CallDirection;
}
