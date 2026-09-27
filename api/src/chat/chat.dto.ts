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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ChatMessageType, ConversationType } from '@prisma/client';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class ChatPageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  /** Tab tìm kiếm: `DIRECT` cho "Tin nhắn", `GROUP` cho "Nhóm"; vắng là "Tất cả" */
  @IsOptional() @IsEnum(ConversationType) type?: ConversationType;
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

/**
 * Đổi tên và / hoặc ảnh nhóm.
 *
 * `avatar_file_id: null` là XOÁ ảnh nhóm — nhóm trở về hình mặc định. Không
 * gửi khoá đó mới là "để ảnh nguyên như cũ". Cùng một khuôn với
 * `UpdateFriendAvatarDto`, và cùng một lý do: chuỗi rỗng không phải một id tệp
 * hợp lệ, nên `null` nói rõ ý hơn.
 */
export class UpdateGroupConversationDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(50) title?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(64)
  avatar_file_id?: string | null;
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

/**
 * Thẻ xem trước gửi kèm tin nhắn.
 *
 * App lấy nó từ `GET chat/link-preview` LÚC SOẠN rồi gửi lại nguyên văn, nên
 * bấm Gửi không phải đợi thêm một lượt mạng ra Internet.
 *
 * `url` bắt buộc; nếu app bịa ra một thẻ thì cũng chỉ là thẻ trong tin nhắn
 * của chính nó — người nhận thấy đúng thứ người gửi gửi đi, như mọi nội dung
 * khác trong tin.
 */
export class LinkPreviewDto {
  @Transform(trim) @IsString() @MaxLength(2_048) url!: string;
  @Transform(trim) @IsString() @MaxLength(200) title!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(400) description?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2_048) image?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) site_name?: string | null;
}

export class LinkPreviewQueryDto {
  @Transform(trim) @IsString() @MaxLength(2_048) url!: string;
}

export class CreateChatMessageDto {
  @IsEnum(ChatMessageType) message_type: ChatMessageType = ChatMessageType.TEXT;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(10_000) content?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => MessageAttachmentDto)
  attachments?: MessageAttachmentDto[];
  @IsUUID('4') client_message_id!: string;
  @IsOptional() @IsString() @MaxLength(64) reply_to_message_id?: string;
  @IsOptional() @ValidateNested() @Type(() => LinkPreviewDto) link_preview?: LinkPreviewDto | {
    url: string;
    title: string;
    description: string | null;
    image: string | null;
    site_name: string | null;
  };
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
  linkPreview?: {
    url: string;
    title: string;
    description: string | null;
    image: string | null;
    site_name: string | null;
  };
  replyToMessageId?: string;
};
