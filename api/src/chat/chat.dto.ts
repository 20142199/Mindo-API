import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ChatMessageType } from '@prisma/client';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class ChatPageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
}

export class ChatMessageQueryDto {
  @IsOptional() @IsString() @MaxLength(64) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(100) q?: string;
}

export class StartDirectConversationDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(64) user_id!: string;
}

export class CreateGroupConversationDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(50) title!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(99) @ArrayUnique()
  @IsString({ each: true }) member_user_ids!: string[];
  @IsOptional() @IsString() @MaxLength(64) avatar_file_id?: string;
}

export class UpdateGroupConversationDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(50) title?: string;
  @IsOptional() @IsString() @MaxLength(64) avatar_file_id?: string;
}

export class AddGroupMembersDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(99) @ArrayUnique()
  @IsString({ each: true }) member_user_ids!: string[];
}

export class UpdateMuteDto {
  @IsBoolean() is_muted!: boolean;
}

export class MarkConversationReadDto {
  @IsOptional() @IsString() @MaxLength(64) message_id?: string;
}

export class MessageAttachmentDto {
  @IsString() @MinLength(1) @MaxLength(64) file_id!: string;
}

export class CreateChatMessageDto {
  @IsEnum(ChatMessageType) message_type: ChatMessageType = ChatMessageType.TEXT;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(10_000) content?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => MessageAttachmentDto)
  attachments?: MessageAttachmentDto[];
  @IsUUID('4') client_message_id!: string;
  @IsOptional() @IsString() @MaxLength(64) reply_to_message_id?: string;
}

export class EditChatMessageDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(10_000) content!: string;
}

export type SocketMessageSendDto = {
  channelId: string;
  messageType?: ChatMessageType;
  content?: string;
  attachments?: Array<{ fileId: string }>;
  clientMessageId: string;
  replyToMessageId?: string;
};
