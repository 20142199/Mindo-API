import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ChatMessageType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../common/prisma.module';
import { ChatService } from './chat.service';

/**
 * `editMessage` chỉ ghi đè cột `content` và không đụng tới `attachments`.
 *
 * Nên với một tin ẢNH nó nhận đoạn chữ rồi lưu ngay cạnh tệp vẫn còn nguyên.
 * Bong bóng ảnh bên client không vẽ đoạn chữ đó ở đâu cả, nhưng dòng xem
 * trước ở danh sách hội thoại thì có — thành ra một tin ảnh mang dòng xem
 * trước bịa ra, và người dùng không có cách nào gỡ.
 *
 * Không có gì chặn: app hiện mục "Sửa tin nhắn" cho mọi tin của mình, bất kể
 * loại. Thấy khi giữ lâu một bong bóng ảnh trên iPhone thật.
 */

const author = 'user-a';

function messageRow(type: ChatMessageType, over: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    senderId: author,
    type,
    content: type === ChatMessageType.TEXT ? 'Xin chào' : null,
    attachments: type === ChatMessageType.TEXT ? null : [{ file_id: 'file-1' }],
    deletedAt: null,
    editedAt: null,
    createdAt: new Date(),
    replyToId: null,
    quotedMessageSnapshot: null,
    clientMessageId: null,
    ...over,
  };
}

function buildService(row: ReturnType<typeof messageRow>) {
  const update = vi.fn(() => Promise.resolve({ ...row, content: 'chữ mới', sender: null }));
  const prisma = {
    chatMessage: {
      findUnique: () => Promise.resolve(row),
      update,
    },
    conversationMember: { findFirst: () => Promise.resolve({ id: 'member-1' }) },
    fileUpload: { findMany: () => Promise.resolve([]) },
    savedChatMessage: { findMany: () => Promise.resolve([]) },
  } as unknown as PrismaService;

  const service = new ChatService(
    prisma,
    { view: () => ({ public_url: 'https://x' }) } as never,
    { publishNewMessage: vi.fn(), publishMessageUpdate: vi.fn() } as never,
    { notifyNewMessage: vi.fn() } as never,
  );

  return { service, update };
}

describe('sửa tin nhắn', () => {
  it('tin chữ thì sửa được', async () => {
    const { service, update } = buildService(messageRow(ChatMessageType.TEXT));

    await service.editMessage(author, 'msg-1', { content: 'chữ mới' });

    expect(update).toHaveBeenCalledOnce();
  });

  /*
    Ba ca dưới là cùng một lỗi. Cột `content` là thứ duy nhất endpoint này
    ghi, mà với tin không phải chữ thì nó không phải nơi nội dung nằm.
  */
  it('tin ảnh thì từ chối, không ghi đè gì', async () => {
    const { service, update } = buildService(messageRow(ChatMessageType.IMAGE));

    await expect(service.editMessage(author, 'msg-1', { content: 'chữ mới' }))
      .rejects.toThrow(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('tin tệp thì từ chối', async () => {
    const { service } = buildService(messageRow(ChatMessageType.FILE));

    await expect(service.editMessage(author, 'msg-1', { content: 'chữ mới' }))
      .rejects.toThrow(BadRequestException);
  });

  it('tin hệ thống thì từ chối', async () => {
    const { service } = buildService(messageRow(ChatMessageType.SYSTEM));

    await expect(service.editMessage(author, 'msg-1', { content: 'chữ mới' }))
      .rejects.toThrow(BadRequestException);
  });

  /* Cửa sổ 72 giờ vẫn phải giữ, và phải chặn SAU khi đã qua cửa kiểu tin —
     một tin ảnh quá hạn thì lý do từ chối đúng là "không phải tin chữ". */
  it('tin chữ quá 72 giờ thì vẫn từ chối như cũ', async () => {
    const { service } = buildService(
      messageRow(ChatMessageType.TEXT, {
        createdAt: new Date(Date.now() - 73 * 60 * 60 * 1000),
      }),
    );

    await expect(service.editMessage(author, 'msg-1', { content: 'chữ mới' }))
      .rejects.toThrow(ForbiddenException);
  });
});
