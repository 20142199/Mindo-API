import { ChatMessageType, ConversationMemberRole, ConversationType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../common/prisma.module';
import { ChatService } from './chat.service';

/**
 * Bị đưa ra khỏi nhóm thì cả nhóm thấy một dòng hệ thống; tự rời thì không.
 *
 * Cùng một sự việc — bớt một người — mà chỉ một nửa số đường đi báo lại. Người
 * ở lại mở nhóm ra thấy danh sách ngắn đi mà không có gì giải thích, và dòng
 * xem trước ở danh sách hội thoại vẫn là tin cũ.
 *
 * Chỗ duy nhất không viết là lúc nhóm vừa tan: chủ nhóm rời đi mà không còn ai
 * kế nhiệm thì hội thoại bị xóa mềm ngay trong cùng giao dịch.
 */

const leaver = 'user-a';
const other = 'user-b';

function buildService(role: ConversationMemberRole, successor: { userId: string } | null) {
  const created = vi.fn((args: { data: { content: string } }) =>
    Promise.resolve({
      id: 'msg-sys',
      conversationId: 'conv-1',
      senderId: null,
      sender: null,
      type: ChatMessageType.SYSTEM,
      content: args.data.content,
      attachments: null,
      deletedAt: null,
      editedAt: null,
      createdAt: new Date(),
      replyToId: null,
      quotedMessageSnapshot: null,
      clientMessageId: null,
    }),
  );
  const conversationUpdate = vi.fn(() => Promise.resolve({}));
  const memberUpdate = vi.fn(() => Promise.resolve({}));

  const tx = {
    conversationMember: { findFirst: () => Promise.resolve(successor), update: memberUpdate },
    conversation: { update: conversationUpdate },
  };

  const prisma = {
    conversationMember: {
      findFirst: () => Promise.resolve({ id: 'member-1', userId: leaver, conversationId: 'conv-1', role }),
      update: memberUpdate,
    },
    conversation: {
      findUnique: () => Promise.resolve({ id: 'conv-1', type: ConversationType.GROUP, deletedAt: null }),
      update: conversationUpdate,
    },
    $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    chatMessage: { create: created },
    user: { findUnique: () => Promise.resolve({ fullName: 'Nguyen Hong Son', nickname: null }) },
    fileUpload: { findMany: () => Promise.resolve([]) },
    savedChatMessage: { findMany: () => Promise.resolve([]) },
  } as unknown as PrismaService;

  const service = new ChatService(
    prisma,
    { view: () => ({ public_url: 'https://x' }) } as never,
    { isOnline: () => false } as never,
  );

  return { service, created, conversationUpdate };
}

describe('rời nhóm', () => {
  it('thành viên thường rời thì viết dòng hệ thống và trả về cho người gọi', async () => {
    const { service, created } = buildService(ConversationMemberRole.MEMBER, null);

    const data = await service.leaveGroup(leaver, 'conv-1');

    expect(created).toHaveBeenCalledOnce();
    expect(created.mock.calls[0][0].data.content).toBe('Nguyen Hong Son đã rời nhóm');
    /* Phải trả ra thì controller mới phát được qua socket — viết vào cơ sở dữ
       liệu thôi thì người đang mở nhóm không thấy gì cho tới lần nạp sau. */
    expect(data.system_message).toBeDefined();
  });

  it('chủ nhóm rời mà còn người kế nhiệm thì vẫn viết', async () => {
    const { service, created } = buildService(ConversationMemberRole.OWNER, { userId: other });

    const data = await service.leaveGroup(leaver, 'conv-1');

    expect(created).toHaveBeenCalledOnce();
    expect(data.system_message).toBeDefined();
  });

  it('chủ nhóm rời mà không còn ai thì nhóm tan, không viết gì', async () => {
    const { service, created } = buildService(ConversationMemberRole.OWNER, null);

    const data = await service.leaveGroup(leaver, 'conv-1');

    expect(created).not.toHaveBeenCalled();
    expect(data.system_message).toBeUndefined();
  });
});
