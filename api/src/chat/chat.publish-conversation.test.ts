import { ConversationMemberRole, ConversationType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../common/prisma.module';
import { ChatService } from './chat.service';

/**
 * Một sự kiện, một lần đọc CSDL.
 *
 * `publishConversation` bắn về cho TẤT CẢ thành viên, và mỗi người cần một
 * payload riêng — số chưa đọc, `is_muted`, `is_own` của tin cuối, và với hội
 * thoại 1-1 là tên/ảnh của "người kia".
 *
 * Bản đầu lấy điều đó làm cớ để gọi `getConversationItemForUser` cho từng
 * người, mà mỗi lần là năm truy vấn: kiểm tư cách thành viên, đọc hội thoại
 * kèm quan hệ, đọc online, đọc tệp, đếm chưa đọc. Nhóm 99 người — mức trần
 * `CreateGroupConversationDto` cho phép — là gần 500 truy vấn cho MỘT tin.
 *
 * Phần khác nhau giữa những người nhận nhỏ hơn nhiều so với phần giống nhau.
 */

const members = ['u-1', 'u-2', 'u-3'];

function buildService() {
  const findFirst = vi.fn(() =>
    Promise.resolve({
      id: 'conv-1',
      type: ConversationType.GROUP,
      title: 'Nhóm kiểm thử',
      avatarFileId: null,
      lastMessageAt: new Date(),
      createdAt: new Date(),
      members: members.map((userId, index) => ({
        userId,
        role: index === 0 ? ConversationMemberRole.OWNER : ConversationMemberRole.MEMBER,
        isMuted: false,
        lastReadAt: null,
        lastReadMessageId: null,
        joinedAt: new Date(),
        user: { id: userId, fullName: userId, nickname: null, email: null, phone: null, avatarFileId: null },
      })),
      messages: [],
    }),
  );
  const count = vi.fn(() => Promise.resolve(0));
  const fileFindMany = vi.fn(() => Promise.resolve([]));
  const onlineMap = vi.fn(() => Promise.resolve(new Map<string, boolean>()));

  const prisma = {
    conversation: { findFirst },
    chatMessage: { count },
    fileUpload: { findMany: fileFindMany },
    conversationMember: { findFirst: () => Promise.resolve({ id: 'm-1' }) },
  } as unknown as PrismaService;

  const service = new ChatService(
    prisma,
    { view: () => ({ public_url: 'https://x' }) } as never,
    { isOnline: () => false, onlineMap } as never,
  );

  return { service, findFirst, count, fileFindMany, onlineMap };
}

describe('dựng payload hội thoại cho cả phòng', () => {
  it('đọc hội thoại đúng MỘT lần dù có bao nhiêu người', async () => {
    const { service, findFirst, fileFindMany, onlineMap } = buildService();

    await service.getConversationItemsForMembers('conv-1', members);

    expect(findFirst).toHaveBeenCalledOnce();
    expect(fileFindMany).not.toHaveBeenCalled(); // không ai có ảnh
    expect(onlineMap).toHaveBeenCalledOnce();
  });

  /* Số chưa đọc thì KHÔNG gộp được: nó đếm theo mốc `lastReadAt` riêng của
     từng người. Một lần đếm cho mỗi người là đúng, và là truy vấn rẻ. */
  it('vẫn đếm chưa đọc riêng cho từng người', async () => {
    const { service, count } = buildService();

    await service.getConversationItemsForMembers('conv-1', members);

    expect(count).toHaveBeenCalledTimes(members.length);
  });

  it('trả về payload cho đúng từng người', async () => {
    const { service } = buildService();

    const items = await service.getConversationItemsForMembers('conv-1', members);

    expect([...items.keys()]).toEqual(members);
  });

  /* Người vừa rời nhóm không còn trong `members` của hàng đã đọc. Dựng
     payload cho họ sẽ vấp phải `ownMember` rỗng, nên bỏ qua hẳn. */
  it('bỏ qua người đã rời nhóm', async () => {
    const { service } = buildService();

    const items = await service.getConversationItemsForMembers('conv-1', [
      ...members,
      'u-da-roi',
    ]);

    expect(items.has('u-da-roi')).toBe(false);
    expect(items.size).toBe(members.length);
  });

  it('không có ai thì không đọc CSDL', async () => {
    const { service, findFirst } = buildService();

    const items = await service.getConversationItemsForMembers('conv-1', []);

    expect(items.size).toBe(0);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
