import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../common/prisma.module';
import { FileStorageService } from '../phase1/file-storage.service';
import { ChatPresenceService } from './chat-presence.service';
import { ChatService } from './chat.service';

/**
 * Đổi tên và ảnh nhóm (2026-09-27).
 *
 * Khác hẳn tên gợi nhớ và ảnh liên hệ ở luồng 1-1: hai thứ đó là ghi đè RIÊNG
 * TƯ một chiều trên `Friendship`, người kia không hề biết. Tên và ảnh nhóm thì
 * CHUNG — sửa một lần là cả nhóm thấy. Nên hai điều kiện đi kèm:
 *
 *   - chỉ chủ nhóm và quản trị viên sửa được (`assertManager`);
 *   - mỗi lần đổi để lại một tin hệ thống, đứng cùng hàng với thêm / xoá /
 *     rời thành viên. Đổi cả tên và ảnh cùng lúc thì GỘP một tin: đó là một
 *     thao tác của người dùng, không phải hai.
 *
 * `titleNormalized` không xuất hiện ở đây, và đó là CỐ Ý: trigger
 * `conversation_search_sync` lo cột đó ở tầng CSDL. Ghi thêm ở tầng ứng dụng
 * là hai nơi cùng ghi một cột.
 */

const files = {} as FileStorageService;
const presence = {} as ChatPresenceService;

const group = {
  id: 'c-1',
  type: 'GROUP',
  title: 'Nhóm cũ',
  avatarFileId: 'file-cu',
  deletedAt: null,
};

/** `assertManager` đọc hàng thành viên rồi xét `role` */
const ownerRow = { userId: 'u-me', conversationId: 'c-1', leftAt: null, role: 'OWNER' };
const memberRow = { ...ownerRow, role: 'MEMBER' };

function serviceWith(overrides: {
  member?: unknown;
  conversation?: unknown;
  update?: ReturnType<typeof vi.fn>;
  create?: ReturnType<typeof vi.fn>;
}) {
  const prisma = {
    conversationMember: { findFirst: vi.fn().mockResolvedValue(overrides.member ?? ownerRow) },
    conversation: {
      findUnique: vi.fn().mockResolvedValue(overrides.conversation ?? group),
      update: overrides.update ?? vi.fn().mockResolvedValue({}),
    },
    chatMessage: { create: overrides.create ?? vi.fn().mockResolvedValue(systemRow('...')) },
    savedChatMessage: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findUnique: vi.fn().mockResolvedValue({ fullName: 'Sơn', nickname: null }) },
  };
  const service = new ChatService(prisma as never, files, presence);
  /* Payload hội thoại đầy đủ là việc của `getConversation`, và nó có test
     riêng — ở đây chỉ cần nó đừng chạm vào prisma. */
  vi.spyOn(service, 'getConversation').mockResolvedValue({ id: 'c-1' } as never);
  return { service, prisma };
}

function systemRow(content: string) {
  return {
    id: 'm-sys',
    conversationId: 'c-1',
    senderId: null,
    sender: null,
    type: 'SYSTEM',
    content,
    attachments: [],
    createdAt: new Date('2026-09-27T00:00:00.000Z'),
  };
}

/** Nội dung tin hệ thống vừa ghi, để khỏi lặp lại cách bóc `create` */
function systemContent(create: ReturnType<typeof vi.fn>) {
  return create.mock.calls[0]?.[0]?.data?.content as string | undefined;
}

describe('đổi tên và ảnh nhóm', () => {
  it('xoá được ảnh nhóm bằng avatar_file_id null', async () => {
    const update = vi.fn().mockResolvedValue({});
    const { service } = serviceWith({ update });

    await service.updateGroup('u-me', 'c-1', { avatar_file_id: null });

    /* `null` là một Ý ĐỊNH, không phải "không gửi gì". Bản cũ xét truthy nên
       nó rơi vào cùng một rổ với `undefined` và bị chặn ngay ở cửa vào. */
    expect(update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { avatarFileId: null },
    });
  });

  it('không gửi gì cả thì vẫn báo lỗi', async () => {
    const { service } = serviceWith({});

    await expect(service.updateGroup('u-me', 'c-1', {})).rejects.toThrow(BadRequestException);
  });

  it('đổi cả tên và ảnh chỉ sinh MỘT tin hệ thống', async () => {
    const create = vi.fn().mockResolvedValue(systemRow('gộp'));
    const { service } = serviceWith({ create });

    const result = await service.updateGroup('u-me', 'c-1', { title: 'Nhóm mới', avatar_file_id: null });

    expect(create).toHaveBeenCalledTimes(1);
    expect(systemContent(create)).toBe('Sơn đã đổi tên nhóm thành "Nhóm mới" và xoá ảnh nhóm');
    expect(result.system_message).toBeTruthy();
  });

  it('đổi riêng tên thì tin chỉ nói về tên', async () => {
    const create = vi.fn().mockResolvedValue(systemRow('tên'));
    const { service } = serviceWith({ create });

    await service.updateGroup('u-me', 'c-1', { title: 'Nhóm mới' });

    expect(systemContent(create)).toBe('Sơn đã đổi tên nhóm thành "Nhóm mới"');
  });

  it('đặt lại đúng cái tên đang có thì không sinh tin nào', async () => {
    const create = vi.fn();
    const { service } = serviceWith({ create });

    const result = await service.updateGroup('u-me', 'c-1', { title: 'Nhóm cũ' });

    /* Không có gì thay đổi thì không có gì để kể. Thiếu chỗ này là mỗi lần
       bấm Lưu cho vui lại đẩy một dòng rác vào khung chat. */
    expect(create).not.toHaveBeenCalled();
    expect(result.system_message).toBeNull();
  });

  it('xoá ảnh của nhóm vốn không có ảnh cũng không sinh tin', async () => {
    const create = vi.fn();
    const { service } = serviceWith({ conversation: { ...group, avatarFileId: null }, create });

    await service.updateGroup('u-me', 'c-1', { avatar_file_id: null });

    expect(create).not.toHaveBeenCalled();
  });

  it('thành viên thường không đổi được', async () => {
    const { service } = serviceWith({ member: memberRow });

    await expect(service.updateGroup('u-me', 'c-1', { title: 'Nhóm mới' })).rejects.toThrow(ForbiddenException);
  });
});
