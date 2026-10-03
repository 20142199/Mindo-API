import { ChatMessageType, ConversationMemberRole, ConversationType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { FileStorageService } from '../phase1/file-storage.service';
import { ChatPresenceService } from './chat-presence.service';
import { ChatService } from './chat.service';

/**
 * Tin hệ thống của nhóm mang thêm `system_info` có cấu trúc (2026-10-03).
 *
 * `content` là MỘT câu dựng sẵn ở server, theo góc nhìn của không ai cả:
 * người tạo nhóm mở máy ra đọc "Nguyen Hong Son đã tạo nhóm" thay vì "Bạn đã
 * tạo nhóm", và tên gợi nhớ mình đặt cho bạn bè không bao giờ xuất hiện. Server
 * không dựng câu riêng được vì `message:new` phát MỘT payload cho cả phòng.
 *
 * Nên server gửi kèm ai làm, làm gì, với ai — app tự dựng câu cho người đang
 * xem. `content` giữ nguyên từng chữ để app cũ và tin cũ không vỡ.
 */

const files = {} as FileStorageService;
const presence = {} as ChatPresenceService;

const names: Record<string, { fullName: string; nickname: string | null }> = {
  'u-me': { fullName: 'Nguyen Hong Son', nickname: null },
  'u-anna': { fullName: 'Anna Nguyễn', nickname: 'Anna' },
  'u-binh': { fullName: 'Trần Bình', nickname: null },
};

const groupRow = { id: 'c-1', type: ConversationType.GROUP, title: 'Nhóm cũ', avatarFileId: 'file-cu', deletedAt: null };

function buildService(opts: {
  role?: ConversationMemberRole;
  targetRole?: ConversationMemberRole;
  successor?: { userId: string } | null;
  /** Ai trong danh sách thêm vào đang là thành viên (chưa rời) từ trước */
  alreadyActive?: string[];
} = {}) {
  const create = vi.fn((args: { data: Record<string, unknown> }) =>
    Promise.resolve({
      id: 'm-sys',
      conversationId: 'c-1',
      senderId: null,
      sender: null,
      type: ChatMessageType.SYSTEM,
      content: args.data.content,
      systemInfo: args.data.systemInfo ?? null,
      callInfo: null,
      attachments: null,
      linkPreview: null,
      replyToId: null,
      quotedMessageSnapshot: null,
      clientMessageId: null,
      editedAt: null,
      deletedAt: null,
      createdAt: new Date('2026-10-03T00:00:00.000Z'),
    }),
  );
  const memberUpdate = vi.fn().mockResolvedValue({});
  const tx = {
    conversationMember: { findFirst: vi.fn().mockResolvedValue(opts.successor ?? null), update: memberUpdate },
    conversation: { update: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    conversationMember: {
      /* Lần đầu là người đang thao tác, lần sau (removeMember) là người bị xoá */
      findFirst: vi.fn()
        .mockResolvedValueOnce({ userId: 'u-me', conversationId: 'c-1', role: opts.role ?? ConversationMemberRole.OWNER, joinedAt: new Date() })
        .mockResolvedValue({ userId: 'u-binh', conversationId: 'c-1', role: opts.targetRole ?? ConversationMemberRole.MEMBER, joinedAt: new Date() }),
      findMany: vi.fn().mockResolvedValue((opts.alreadyActive ?? []).map((userId) => ({ userId }))),
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
      updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      update: memberUpdate,
    },
    conversation: {
      create: vi.fn().mockResolvedValue({ id: 'c-1' }),
      findUnique: vi.fn().mockResolvedValue(groupRow),
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    friendship: { count: vi.fn((args: { where: { friendUserId: { in: string[] } } }) => Promise.resolve(args.where.friendUserId.in.length)) },
    chatMessage: { create },
    user: {
      findUnique: vi.fn((args: { where: { id: string } }) => Promise.resolve(names[args.where.id] ?? null)),
      findMany: vi.fn((args: { where: { id: { in: string[] } } }) =>
        Promise.resolve(args.where.id.in.filter((id) => names[id]).map((id) => ({ id, ...names[id] })))),
    },
    savedChatMessage: { findMany: vi.fn().mockResolvedValue([]) },
    fileUpload: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const service = new ChatService(prisma as never, files, presence);
  vi.spyOn(service, 'getConversation').mockResolvedValue({ conversation_id: 'c-1' } as never);
  return { service, create, prisma };
}

function written(create: ReturnType<typeof vi.fn>) {
  return create.mock.calls[0]?.[0]?.data as { content: string; systemInfo: Record<string, unknown>; senderId?: string };
}

describe('tạo nhóm', () => {
  it('ghi người tạo, giữ nguyên câu cũ', async () => {
    const { service, create } = buildService();

    const result = await service.createGroup('u-me', { title: 'Nhóm mới', member_user_ids: ['u-anna'] } as never);

    expect(written(create).content).toBe('Nguyen Hong Son đã tạo nhóm');
    expect(written(create).systemInfo).toEqual({ event: 'GROUP_CREATED', actor_user_id: 'u-me', actor_name: 'Nguyen Hong Son' });
    /* Không gán người làm vào `senderId`: `last_message.is_own` của app cũ sẽ
       đổi nghĩa và hiện "Bạn: …" sai. */
    expect(written(create).senderId).toBeUndefined();
    expect(result.system_message.system_info).toEqual(written(create).systemInfo);
  });
});

describe('đổi tên / ảnh nhóm', () => {
  it('đổi tên thì có new_title, ảnh không đổi thì avatar null', async () => {
    const { service, create } = buildService();

    await service.updateGroup('u-me', 'c-1', { title: 'Nhóm mới' });

    expect(written(create).content).toBe('Nguyen Hong Son đã đổi tên nhóm thành "Nhóm mới"');
    expect(written(create).systemInfo).toEqual({
      event: 'GROUP_UPDATED',
      actor_user_id: 'u-me',
      actor_name: 'Nguyen Hong Son',
      new_title: 'Nhóm mới',
      avatar: null,
    });
  });

  it('xoá ảnh thì avatar REMOVED, tên không đổi thì new_title null', async () => {
    const { service, create } = buildService();

    await service.updateGroup('u-me', 'c-1', { avatar_file_id: null });

    expect(written(create).systemInfo).toMatchObject({ event: 'GROUP_UPDATED', new_title: null, avatar: 'REMOVED' });
  });

  it('đổi ảnh thì avatar CHANGED, gộp với đổi tên trong một tin', async () => {
    const { service, create } = buildService();
    (service as unknown as { files: unknown }).files = {
      assertOwned: vi.fn().mockResolvedValue({ mimeType: 'image/png' }),
    };

    await service.updateGroup('u-me', 'c-1', { title: 'Nhóm mới', avatar_file_id: 'file-moi' });

    expect(create).toHaveBeenCalledTimes(1);
    expect(written(create).content).toBe('Nguyen Hong Son đã đổi tên nhóm thành "Nhóm mới" và đổi ảnh nhóm');
    expect(written(create).systemInfo).toMatchObject({ new_title: 'Nhóm mới', avatar: 'CHANGED' });
  });
});

describe('thêm thành viên', () => {
  it('kèm id và tên chụp lúc thêm của từng người, đúng thứ tự gửi lên', async () => {
    const { service, create } = buildService();

    await service.addMembers('u-me', 'c-1', { member_user_ids: ['u-binh', 'u-anna'] });

    expect(written(create).content).toBe('Nguyen Hong Son đã thêm 2 thành viên');
    expect(written(create).systemInfo).toEqual({
      event: 'MEMBERS_ADDED',
      actor_user_id: 'u-me',
      actor_name: 'Nguyen Hong Son',
      target_user_ids: ['u-binh', 'u-anna'],
      target_names: ['Trần Bình', 'Anna'],
    });
  });
});

describe('thêm người đã ở sẵn trong nhóm', () => {
  /* createMany bỏ qua trùng, updateMany không đổi gì với người đang ở nhóm —
     nên họ KHÔNG được kể là "vừa thêm". App dựng câu từng tên một, ghi họ vào
     là hiện "Bạn đã thêm A và B" trong khi A ở đó từ lâu. */
  it('chỉ kể những người thật sự vừa vào', async () => {
    const { service, create, prisma } = buildService({ alreadyActive: ['u-anna'] });

    await service.addMembers('u-me', 'c-1', { member_user_ids: ['u-binh', 'u-anna'] });

    expect(prisma.conversationMember.findMany.mock.calls[0][0].where).toEqual({
      conversationId: 'c-1',
      userId: { in: ['u-binh', 'u-anna'] },
      leftAt: null,
    });
    expect(written(create).content).toBe('Nguyen Hong Son đã thêm 1 thành viên');
    expect(written(create).systemInfo).toMatchObject({ target_user_ids: ['u-binh'], target_names: ['Trần Bình'] });
  });

  /* Người đã rời (leftAt khác null) được thêm lại là vào nhóm thật: phải kể. */
  it('người từng rời được thêm lại thì vẫn kể', async () => {
    const { service, create } = buildService({ alreadyActive: [] });

    await service.addMembers('u-me', 'c-1', { member_user_ids: ['u-binh'] });

    expect(written(create).systemInfo).toMatchObject({ target_user_ids: ['u-binh'] });
  });

  /* Không ai mới thì không có gì để kể, và cũng không có gì để làm. Không báo
     lỗi: app gửi lại sau khi mạng chập phải nhận kết quả như lần đầu. */
  it('tất cả đã ở sẵn thì thành công, không ghi tin rác', async () => {
    const { service, create, prisma } = buildService({ alreadyActive: ['u-binh', 'u-anna'] });

    const result = await service.addMembers('u-me', 'c-1', { member_user_ids: ['u-binh', 'u-anna'] });

    expect(result.system_message).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(prisma.conversationMember.createMany).not.toHaveBeenCalled();
  });
});

describe('xoá thành viên', () => {
  it('ghi cả người xoá lẫn người bị xoá', async () => {
    const { service, create } = buildService();

    await service.removeMember('u-me', 'c-1', 'u-binh');

    /* Câu cũ không nhắc người làm — giữ nguyên, phần đó giờ nằm ở system_info. */
    expect(written(create).content).toBe('Trần Bình đã được đưa ra khỏi nhóm');
    expect(written(create).systemInfo).toEqual({
      event: 'MEMBER_REMOVED',
      actor_user_id: 'u-me',
      actor_name: 'Nguyen Hong Son',
      target_user_ids: ['u-binh'],
      target_names: ['Trần Bình'],
    });
  });
});

describe('rời nhóm', () => {
  it('người rời là người làm', async () => {
    const { service, create } = buildService({ role: ConversationMemberRole.MEMBER });

    const result = await service.leaveGroup('u-me', 'c-1');

    expect(written(create).content).toBe('Nguyen Hong Son đã rời nhóm');
    expect(written(create).systemInfo).toEqual({ event: 'MEMBER_LEFT', actor_user_id: 'u-me', actor_name: 'Nguyen Hong Son' });
    expect(result.system_message?.system_info).toMatchObject({ event: 'MEMBER_LEFT' });
  });
});

describe('đọc ra', () => {
  /* Tin cũ trước migration và tin thường không có cột này: phải là null chứ
     không phải thiếu khoá, để app chỉ cần một phép so. */
  it('tin không có systemInfo thì system_info là null', async () => {
    const row = {
      id: 'm-1',
      conversationId: 'c-1',
      senderId: null,
      sender: null,
      type: ChatMessageType.SYSTEM,
      content: 'Nguyen Hong Son đã tạo nhóm',
      attachments: null,
      replyToId: null,
      quotedMessageSnapshot: null,
      createdAt: new Date(),
    };
    const service = new ChatService({
      chatMessage: { findUniqueOrThrow: vi.fn().mockResolvedValue(row) },
      savedChatMessage: { findMany: vi.fn().mockResolvedValue([]) },
    } as never, files, presence);

    const view = await service.messageView('u-me', 'm-1');

    expect(view.system_info).toBeNull();
    expect(view.content).toBe('Nguyen Hong Son đã tạo nhóm');
  });

  /* Dòng xem trước ở danh sách hội thoại cũng phải dựng được "Bạn đã tạo
     nhóm", nên `last_message` mang theo cùng trường đó. */
  it('last_message của hội thoại cũng mang system_info', async () => {
    const info = { event: 'GROUP_CREATED', actor_user_id: 'u-me', actor_name: 'Nguyen Hong Son' };
    const me = { id: 'u-me', fullName: 'Nguyen Hong Son', nickname: null, email: null, phone: null, avatarFileId: null, lastSeenAt: null };
    const member = {
      userId: 'u-me', role: ConversationMemberRole.OWNER, isMuted: false, lastReadMessageId: null,
      lastReadAt: null, joinedAt: new Date(), user: me,
    };
    const row = {
      ...groupRow,
      avatarFileId: null,
      lastMessageAt: new Date(),
      createdAt: new Date(),
      members: [member],
      messages: [{
        id: 'm-sys', senderId: null, sender: null, type: ChatMessageType.SYSTEM,
        content: 'Nguyen Hong Son đã tạo nhóm', systemInfo: info, deletedAt: null, createdAt: new Date(),
      }],
    };
    const service = new ChatService({
      conversationMember: { findFirst: vi.fn().mockResolvedValue(member) },
      conversation: { findFirst: vi.fn().mockResolvedValue(row) },
      chatMessage: { count: vi.fn().mockResolvedValue(0) },
    } as never, files, { onlineMap: () => Promise.resolve(new Map()) } as never);

    const view = await service.getConversation('u-me', 'c-1');

    expect(view.last_message?.system_info).toEqual(info);
  });
});
