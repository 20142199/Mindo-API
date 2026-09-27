import { Call, CallStatus, CallType, ChatMessageType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../common/prisma.module';
import { ChatRealtimeService } from '../chat/chat-realtime.service';
import { CallChatLogService } from './call-chat-log.service';

/**
 * Cuộc gọi kết thúc thì hiện thành một dòng trong chat — như Messenger
 * (2026-09-27).
 *
 * Trước đây cuộc gọi chỉ nằm ở màn Lịch sử cuộc gọi, nên dòng thời gian
 * trong hội thoại bị đứt mạch: muốn biết đã gọi lúc nào phải thoát ra màn
 * khác tra lại, trong khi người ta nhớ chuyện theo kiểu "hôm qua gọi nhau
 * xong thì nhắn gì".
 *
 * Hai điều KHÔNG ĐƯỢC SAI:
 *
 *   1. Ghi nhật ký hỏng thì người dùng vẫn phải CÚP MÁY ĐƯỢC. Nó chạy sau
 *      khi trạng thái đã vào CSDL, nên ném ở đây là làm đổ một việc đã xong.
 *   2. Một cuộc gọi sinh ĐÚNG MỘT hội thoại. Hai người gọi nhau mười lần mà
 *      ra mười hội thoại thì danh sách tin nhắn thành rác.
 */

const call = (over: Partial<Call> = {}): Call =>
  ({
    id: 'call-1',
    callerId: 'u-me',
    calleeId: 'u-ban',
    callType: CallType.AUDIO,
    status: CallStatus.COMPLETED,
    durationSec: 135,
    createdAt: new Date('2026-09-27T10:00:00.000Z'),
    ...over,
  } as Call);

/* Khai kiểu tham số cho mock, đừng để `vi.fn(() => …)`.
   Không có kiểu thì `mock.calls` là tuple RỖNG, và `calls[0][0]` không biên
   dịch được — `vitest` vẫn xanh nhưng `nest build` đỏ, vì build biên dịch cả
   tệp test. */
type MessageCreateArgs = {
  data: {
    conversationId: string;
    type: ChatMessageType;
    content: string;
    senderId?: string;
    callInfo: Record<string, unknown>;
  };
};
type ConversationCreateArgs = {
  data: { members: { create: { userId: string }[] } };
};

function build(existingConversation: string | null = 'conv-1') {
  const create = vi.fn((_args: MessageCreateArgs) =>
    Promise.resolve({ id: 'm-1', createdAt: new Date() }),
  );
  const conversationCreate = vi.fn((_args: ConversationCreateArgs) =>
    Promise.resolve({ id: 'conv-moi' }),
  );
  const prisma = {
    conversation: {
      findUnique: vi.fn(() =>
        Promise.resolve(existingConversation ? { id: existingConversation } : null),
      ),
      create: conversationCreate,
      update: vi.fn(() => Promise.resolve({})),
    },
    chatMessage: { create },
  } as unknown as PrismaService;

  const publishConversation = vi.fn(() => Promise.resolve());
  const service = new CallChatLogService(prisma, {
    publishConversation,
  } as unknown as ChatRealtimeService);

  return { service, create, conversationCreate, publishConversation, prisma };
}

describe('ghi cuộc gọi thành tin trong hội thoại', () => {
  it('tạo tin HỆ THỐNG, không có người gửi', async () => {
    const { service, create } = build();

    await service.record(call());

    const data = create.mock.calls[0]![0].data;
    expect(data.type).toBe(ChatMessageType.SYSTEM);
    expect(data.senderId).toBeUndefined();
    expect(data.conversationId).toBe('conv-1');
  });

  it('kèm số liệu để app vẽ icon và cho gọi lại', async () => {
    const { service, create } = build();

    await service.record(call({ callType: CallType.VIDEO }));

    expect(create.mock.calls[0]![0].data.callInfo).toMatchObject({
      call_id: 'call-1',
      call_type: CallType.VIDEO,
      status: CallStatus.COMPLETED,
      duration_sec: 135,
      caller_user_id: 'u-me',
    });
  });

  /* Hai người chưa từng nhắn: gọi xong mở Tin nhắn không thấy gì là mất dấu
     cuộc gọi. Messenger cũng tạo hội thoại trong trường hợp này. */
  it('chưa có hội thoại thì tạo, với đủ hai thành viên', async () => {
    const { service, conversationCreate, create } = build(null);

    await service.record(call());

    const members = conversationCreate.mock.calls[0]![0].data.members.create;
    expect(members).toEqual([{ userId: 'u-me' }, { userId: 'u-ban' }]);
    expect(create.mock.calls[0]![0].data.conversationId).toBe('conv-moi');
  });

  /* Đã có rồi thì DÙNG LẠI. Gọi nhau mười lần mà ra mười hội thoại thì danh
     sách tin nhắn thành rác. */
  it('đã có hội thoại thì không tạo thêm', async () => {
    const { service, conversationCreate } = build('conv-1');

    await service.record(call());

    expect(conversationCreate).not.toHaveBeenCalled();
  });

  it('đẩy cho cả hai máy thấy ngay', async () => {
    const { service, publishConversation } = build();

    await service.record(call());

    expect(publishConversation).toHaveBeenCalledWith('conv-1');
  });
});

describe('câu chữ của từng kết cục', () => {
  const textOf = async (over: Partial<Call>) => {
    const { service, create } = build();
    await service.record(call(over));
    return create.mock.calls[0]![0].data.content;
  };

  it('gọi xong thì kèm thời lượng', async () => {
    expect(await textOf({ durationSec: 135 })).toBe('Cuộc gọi thoại · 2 phút 15 giây');
  });

  it('dưới một phút thì chỉ ghi giây', async () => {
    expect(await textOf({ durationSec: 42 })).toBe('Cuộc gọi thoại · 42 giây');
  });

  /* Tròn phút thì bỏ phần giây — "2 phút 0 giây" đọc lên nghe như máy nói. */
  it('tròn phút thì bỏ phần giây', async () => {
    expect(await textOf({ durationSec: 120 })).toBe('Cuộc gọi thoại · 2 phút');
  });

  it.each([
    [CallStatus.MISSED, 'Cuộc gọi thoại nhỡ'],
    [CallStatus.REJECTED, 'Cuộc gọi thoại bị từ chối'],
    [CallStatus.CANCELLED, 'Cuộc gọi thoại đã huỷ'],
  ])('%s -> %s', async (status, expected) => {
    expect(await textOf({ status })).toBe(expected);
  });

  it('gọi video thì ghi đúng là video', async () => {
    expect(await textOf({ callType: CallType.VIDEO, durationSec: 30 })).toBe(
      'Cuộc gọi video · 30 giây',
    );
  });
});

describe('nhật ký hỏng không được chặn việc cúp máy', () => {
  it('CSDL ném lỗi thì record vẫn trả về bình thường', async () => {
    const prisma = {
      conversation: {
        findUnique: vi.fn(() => Promise.reject(new Error('CSDL sập'))),
      },
    } as unknown as PrismaService;
    const service = new CallChatLogService(prisma, {
      publishConversation: vi.fn(),
    } as unknown as ChatRealtimeService);

    await expect(service.record(call())).resolves.toBeUndefined();
  });

  it('đẩy realtime hỏng cũng không ném', async () => {
    const { prisma } = build();
    const service = new CallChatLogService(prisma, {
      publishConversation: vi.fn(() => Promise.reject(new Error('socket chết'))),
    } as unknown as ChatRealtimeService);

    await expect(service.record(call())).resolves.toBeUndefined();
  });
});
