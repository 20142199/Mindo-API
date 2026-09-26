import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../common/prisma.module';
import { FileStorageService } from '../phase1/file-storage.service';
import { ChatPresenceService } from './chat-presence.service';
import { ChatService } from './chat.service';

/**
 * Xoá tin nhắn "ở phía tôi" (2026-09-27).
 *
 * Thu hồi (`deleteMessage`) gỡ tin khỏi mắt MỌI người và chỉ tác giả làm
 * được — backend chặn thẳng bằng `ownedMessage`. Nhưng người nhận cũng cần
 * dọn hội thoại của mình: một tin rác, một tấm ảnh không muốn thấy nữa. Đó là
 * việc riêng của họ, không đụng gì tới tin gốc, nên nó là bảng phụ theo từng
 * người chứ không phải một cột trên tin.
 */

const files = {} as FileStorageService;
const presence = {} as ChatPresenceService;

function serviceWith(prisma: Partial<PrismaService>) {
  return new ChatService(prisma as PrismaService, files, presence);
}

const message = {
  id: 'm-1',
  conversationId: 'c-1',
  senderId: 'u-ban',
  deletedAt: null,
};

/** Thành viên hợp lệ — `assertMembership` đọc bảng này */
const memberRow = { userId: 'u-me', conversationId: 'c-1', leftAt: null, joinedAt: new Date() };

describe('ẩn tin ở phía mình', () => {
  it('ghi một hàng riêng, KHÔNG đụng vào tin gốc', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const update = vi.fn();
    const service = serviceWith({
      chatMessage: { findUnique: vi.fn().mockResolvedValue(message), update },
      conversationMember: { findFirst: vi.fn().mockResolvedValue(memberRow) },
      hiddenChatMessage: { upsert },
    } as never);

    const result = await service.hideMessage('u-me', 'm-1');

    expect(upsert).toHaveBeenCalledWith({
      where: { userId_messageId: { userId: 'u-me', messageId: 'm-1' } },
      update: {},
      create: { userId: 'u-me', messageId: 'm-1' },
    });
    /* Tin của người khác vẫn nguyên vẹn với họ */
    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({ message_id: 'm-1', conversation_id: 'c-1', hidden: true });
  });

  /* Khác hẳn thu hồi: không đòi quyền tác giả. Tin trên kia là của `u-ban`,
     người ẩn là `u-me`, và vẫn phải chạy trót lọt. */
  it('ẩn được tin của NGƯỜI KHÁC', async () => {
    const service = serviceWith({
      chatMessage: { findUnique: vi.fn().mockResolvedValue(message) },
      conversationMember: { findFirst: vi.fn().mockResolvedValue(memberRow) },
      hiddenChatMessage: { upsert: vi.fn().mockResolvedValue({}) },
    } as never);

    await expect(service.hideMessage('u-me', 'm-1')).resolves.toMatchObject({ hidden: true });
  });

  /* Nhưng vẫn phải là người trong hội thoại — không ai được đụng tới tin của
     một hội thoại mình không thuộc về. */
  it('người ngoài hội thoại thì bị từ chối', async () => {
    const service = serviceWith({
      chatMessage: { findUnique: vi.fn().mockResolvedValue(message) },
      conversationMember: { findFirst: vi.fn().mockResolvedValue(null) },
      hiddenChatMessage: { upsert: vi.fn() },
    } as never);

    await expect(service.hideMessage('u-la', 'm-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('tin không tồn tại thì báo không tìm thấy', async () => {
    const service = serviceWith({
      chatMessage: { findUnique: vi.fn().mockResolvedValue(null) },
      hiddenChatMessage: { upsert: vi.fn() },
    } as never);

    await expect(service.hideMessage('u-me', 'm-x')).rejects.toBeInstanceOf(NotFoundException);
  });

  /* Ẩn hai lần (hai thiết bị) không được coi là lỗi. */
  it('ẩn lại lần nữa vẫn thành công', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const service = serviceWith({
      chatMessage: { findUnique: vi.fn().mockResolvedValue(message) },
      conversationMember: { findFirst: vi.fn().mockResolvedValue(memberRow) },
      hiddenChatMessage: { upsert },
    } as never);

    await service.hideMessage('u-me', 'm-1');
    await service.hideMessage('u-me', 'm-1');

    expect(upsert).toHaveBeenCalledTimes(2);
  });
});
