import { ConversationMemberRole, ConversationType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../common/prisma.module';
import { ChatService } from './chat.service';
import { ChatPageQueryDto } from './chat.dto';

/**
 * Dòng hội thoại phải nói ra NGƯỜI KIA là ai (2026-09-27).
 *
 * Payload danh sách không kèm `members` — mảng đó chỉ đi cùng
 * `GET /conversations/:id`. Phía app vì thế phải moi id người kia ra từ một
 * mảng không tồn tại:
 *
 *     const peer = raw.members?.find(m => !isMe(m.user_id));  // luôn undefined
 *     contactId: peer?.user_id ?? null                        // luôn null
 *
 * `contactId` luôn null kéo theo ba chỗ hỏng cùng lúc: dòng danh sách tra
 * `contactsById[null]` nên không có chữ cái đầu để vẽ và để lại một vòng tròn
 * navy trống; `useMessaging` dựng bản đồ online bằng `.filter(c => c.contactId)`
 * nên bản đồ luôn rỗng và chấm xanh ở dải "Gần đây" chưa bao giờ sáng; và
 * không có khoá nào để khớp một sự kiện presence với hội thoại của nó.
 *
 * `peer` đã nằm sẵn trong `serializeConversationRows` để dựng tiêu đề và ảnh,
 * nên gửi thêm id của họ không tốn truy vấn nào.
 */

type MemberSeed = { userId: string; leftAt?: Date | null; lastSeenAt?: Date | null };

function conversationRow(type: ConversationType, seeds: MemberSeed[]) {
  return {
    id: 'conv-1',
    type,
    title: type === ConversationType.GROUP ? 'Nhóm kiểm thử' : null,
    avatarFileId: null,
    lastMessageAt: new Date('2026-09-27T10:00:00.000Z'),
    createdAt: new Date('2026-09-20T08:00:00.000Z'),
    /* Đúng như `conversationInclude` lọc: `where: { leftAt: null }`, nên
       người đã rời KHÔNG có mặt trong mảng này. */
    members: seeds
      .filter((seed) => !seed.leftAt)
      .map((seed, index) => ({
        userId: seed.userId,
        role: index === 0 ? ConversationMemberRole.OWNER : ConversationMemberRole.MEMBER,
        isMuted: false,
        lastReadAt: null,
        lastReadMessageId: null,
        joinedAt: new Date('2026-09-20T08:00:00.000Z'),
        user: {
          id: seed.userId,
          fullName: `Người ${seed.userId}`,
          nickname: null,
          email: null,
          phone: null,
          avatarFileId: null,
          lastSeenAt: seed.lastSeenAt ?? null,
        },
      })),
    messages: [],
  };
}

function buildService(row: ReturnType<typeof conversationRow>) {
  const prisma = {
    $transaction: (work: unknown[]) => Promise.all(work),
    conversation: {
      count: vi.fn(() => Promise.resolve(1)),
      findMany: vi.fn(() => Promise.resolve([row])),
    },
    chatMessage: { count: vi.fn(() => Promise.resolve(0)) },
    fileUpload: { findMany: vi.fn(() => Promise.resolve([])) },
  } as unknown as PrismaService;

  return new ChatService(
    prisma,
    { view: () => ({ public_url: 'https://x' }) } as never,
    { onlineMap: () => Promise.resolve(new Map<string, boolean>()) } as never,
  );
}

async function firstRow(row: ReturnType<typeof conversationRow>, viewerId: string) {
  const service = buildService(row);
  const result = await service.listConversations(viewerId, new ChatPageQueryDto());
  return result.data[0] as Record<string, unknown>;
}

describe('peer_user_id trong dòng hội thoại', () => {
  it('hội thoại 1-1 trả id NGƯỜI KIA, không phải id của mình', async () => {
    const row = conversationRow(ConversationType.DIRECT, [
      { userId: 'u-me' },
      { userId: 'u-anna' },
    ]);

    const item = await firstRow(row, 'u-me');

    expect(item.peer_user_id).toBe('u-anna');
  });

  /* Người xem là ai thì "người kia" đổi theo — cùng một hàng CSDL, hai payload. */
  it('đổi theo người đang xem', async () => {
    const row = conversationRow(ConversationType.DIRECT, [
      { userId: 'u-me' },
      { userId: 'u-anna' },
    ]);

    const item = await firstRow(row, 'u-anna');

    expect(item.peer_user_id).toBe('u-me');
  });

  /* Nhóm không có "người kia" — hai mươi người thì biết chọn ai. */
  it('nhóm trả null', async () => {
    const row = conversationRow(ConversationType.GROUP, [
      { userId: 'u-me' },
      { userId: 'u-anna' },
      { userId: 'u-bach' },
    ]);

    const item = await firstRow(row, 'u-me');

    expect(item.peer_user_id).toBeNull();
  });

  it('kèm mốc lần cuối của người kia', async () => {
    const row = conversationRow(ConversationType.DIRECT, [
      { userId: 'u-me' },
      { userId: 'u-anna', lastSeenAt: new Date('2026-09-27T01:23:45.000Z') },
    ]);

    const item = await firstRow(row, 'u-me');

    expect(item.last_seen_at).toBe('2026-09-27T01:23:45.000Z');
  });

  /* Chưa từng mở socket chat thì không có mốc nào. App hiểu null là "không
     biết" rồi bỏ trống, chứ không bịa ra "vừa xong". */
  it('người chưa từng online thì mốc là null', async () => {
    const row = conversationRow(ConversationType.DIRECT, [
      { userId: 'u-me' },
      { userId: 'u-anna' },
    ]);

    expect((await firstRow(row, 'u-me')).last_seen_at).toBeNull();
  });

  it('nhóm không có mốc lần cuối', async () => {
    const row = conversationRow(ConversationType.GROUP, [
      { userId: 'u-me' },
      { userId: 'u-anna', lastSeenAt: new Date('2026-09-27T01:23:45.000Z') },
    ]);

    expect((await firstRow(row, 'u-me')).last_seen_at).toBeNull();
  });

  /*
    Người kia rời đi thì `conversationInclude` lọc họ khỏi `members`, còn lại
    mỗi mình. Không được nổ, và không được tự lấy chính mình làm "người kia" —
    làm vậy thì app hiện hội thoại như đang nhắn với bản thân.
  */
  it('người kia đã rời thì trả null chứ không lấy nhầm chính mình', async () => {
    const row = conversationRow(ConversationType.DIRECT, [
      { userId: 'u-me' },
      { userId: 'u-anna', leftAt: new Date('2026-09-26T00:00:00.000Z') },
    ]);

    const item = await firstRow(row, 'u-me');

    expect(item.peer_user_id).toBeNull();
  });
});
