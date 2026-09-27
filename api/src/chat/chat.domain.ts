import { BadRequestException } from '@nestjs/common';
import { ChatMessageType } from '@prisma/client';
import { createHash } from 'node:crypto';
import { SocketMessageSendDto } from './chat.dto';

export function directConversationKey(firstUserId: string, secondUserId: string) {
  if (!firstUserId || !secondUserId || firstUserId === secondUserId) {
    throw new BadRequestException('Hai thành viên của hội thoại phải khác nhau');
  }
  return createHash('sha256').update([firstUserId, secondUserId].sort().join(':')).digest('hex').slice(0, 32);
}

/**
 * Bỏ dấu và hạ chữ thường, để "dau tu" tìm ra "Đầu tư dài hạn".
 *
 * PHẢI cho ra đúng cùng một chuỗi với `mindo_search_key()` bên Postgres
 * (migration `202609270002_search_normalized`) — hàm này chuẩn hoá TỪ KHOÁ,
 * còn hàm kia chuẩn hoá DỮ LIỆU, và chúng được so trực tiếp với nhau. Lệch
 * nhau một ký tự là tìm không ra, mà không có gì báo.
 *
 * `normalize('NFD')` tách dấu thành ký tự tổ hợp rồi xoá đi, nhưng nó KHÔNG
 * đụng tới `đ`/`Đ`: chữ đó là một ký tự riêng chứ không phải `d` cộng dấu.
 * `unaccent` của Postgres thì đổi `Đ` thành `D`, nên ở đây phải đổi bằng tay
 * cho khớp — thiếu dòng đó thì gõ "dau tu" ra kết quả, gõ "đầu tư" lại không.
 */
export function searchKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, (c) => (c === 'đ' ? 'd' : 'D'))
    .toLowerCase()
    .trim();
}

/**
 * Câu thay cho nội dung của một tin đã bị thu hồi.
 *
 * Một chỗ giữ, vì nó xuất hiện ở hai nơi khác nhau — dòng xem trước của hội
 * thoại và ô trích dẫn trong tin trả lời — và hai nơi đó phải nói y hệt nhau.
 */
export const RECALLED_MESSAGE_PREVIEW = 'Tin nhắn đã được thu hồi';

export function messagePreview(type: ChatMessageType, content?: string | null) {
  if (type === ChatMessageType.IMAGE) return content?.trim() || 'Đã gửi một hình ảnh';
  if (type === ChatMessageType.FILE) return content?.trim() || 'Đã gửi một tệp';
  if (type === ChatMessageType.SYSTEM) return content?.trim() || 'Thông báo hệ thống';
  const value = content?.trim() || '';
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}

export function parseSocketMessage(payload: unknown): SocketMessageSendDto {
  if (!payload || typeof payload !== 'object') throw new BadRequestException('Payload tin nhắn không hợp lệ');
  const value = payload as Record<string, unknown>;
  const channelId = typeof value.channelId === 'string' ? value.channelId.trim() : '';
  const clientMessageId = typeof value.clientMessageId === 'string' ? value.clientMessageId.trim() : '';
  const messageType = typeof value.messageType === 'string' ? value.messageType : ChatMessageType.TEXT;
  if (!channelId || channelId.length > 64) throw new BadRequestException('channelId không hợp lệ');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientMessageId)) {
    throw new BadRequestException('clientMessageId phải là UUID v4');
  }
  const clientTypes: ChatMessageType[] = [ChatMessageType.TEXT, ChatMessageType.IMAGE, ChatMessageType.FILE];
  if (!clientTypes.includes(messageType as ChatMessageType)) {
    throw new BadRequestException('messageType không hợp lệ');
  }
  const attachments = Array.isArray(value.attachments)
    ? value.attachments.map((item) => {
      if (!item || typeof item !== 'object' || typeof (item as Record<string, unknown>).fileId !== 'string') {
        throw new BadRequestException('Tệp đính kèm không hợp lệ');
      }
      return { fileId: ((item as Record<string, unknown>).fileId as string).trim() };
    })
    : undefined;
  if (attachments && attachments.length > 5) throw new BadRequestException('Tối đa 5 tệp mỗi tin nhắn');
  const content = typeof value.content === 'string' ? value.content.trim() : undefined;
  if (messageType === ChatMessageType.TEXT && !content) throw new BadRequestException('Tin nhắn chữ không được để trống');
  if (messageType !== ChatMessageType.TEXT && !attachments?.length) throw new BadRequestException('Tin nhắn ảnh/tệp cần tệp đính kèm');
  return {
    channelId,
    clientMessageId,
    messageType: messageType as ChatMessageType,
    content,
    attachments,
    /* Cùng tên với `reply_to_message_id` của REST. Trước đây socket gọi là
       `parentMessageId`, nên app phải dựng hai bộ tên cho cùng một việc gửi
       tin — mà tài liệu lại khuyên dùng cả hai đường. */
    replyToMessageId: typeof value.replyToMessageId === 'string' ? value.replyToMessageId.trim() : undefined,
    linkPreview: parseSocketLinkPreview(value.linkPreview),
  };
}

/**
 * Thẻ xem trước app gửi kèm — nhận thì nhận, sai thì BỎ QUA.
 *
 * Không ném: một cái thẻ hỏng không đáng để cả tin nhắn không gửi được. Cắt
 * độ dài tại đây vì đường socket không đi qua `class-validator` như REST.
 */
function parseSocketLinkPreview(value: unknown): SocketMessageSendDto['linkPreview'] {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  const text = (key: string, max: number) => {
    const raw = item[key];
    return typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, max) : undefined;
  };
  const url = text('url', 2_048);
  const title = text('title', 200);
  if (!url || !title) return undefined;
  return {
    url,
    title,
    description: text('description', 400) ?? null,
    image: text('image', 2_048) ?? null,
    site_name: text('site_name', 80) ?? null,
  };
}
