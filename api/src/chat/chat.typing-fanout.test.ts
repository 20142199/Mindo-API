import { describe, expect, it, vi } from 'vitest';
import { ChatRealtimeService } from './chat-realtime.service';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma.module';
import { ChatService } from './chat.service';
import { ChatPresenceService } from './chat-presence.service';
import { PushNotificationService } from '../notification/push-notification.service';

/**
 * "Đang soạn tin…" phải tới được người ĐANG KHÔNG mở hội thoại (2026-09-26).
 *
 * Tìm ra khi chạy hai tài khoản thật cạnh nhau: máy A gõ, máy B đang đứng ở
 * danh sách Tin nhắn thì dòng xem trước im lìm; chỉ khi B mở hội thoại ra thì
 * chữ "Đang soạn tin…" mới hiện.
 *
 * Lý do nằm ở phòng: `typing:peer` chỉ bắn vào `channel:<id>`, mà người ta
 * chỉ vào phòng đó khi gọi `channel:join`, tức là khi MỞ hội thoại. Phía app
 * đã sẵn sàng từ lâu — `patchList` có, `formatPreview` đã ưu tiên hiện chữ
 * đang soạn — chỉ là sự kiện không bao giờ tới nơi.
 */

type Handler = (payload: unknown, ack?: (res: unknown) => void) => Promise<void>;

function buildSocket(userId: string) {
  const handlers = new Map<string, Handler>();
  const emit = vi.fn();
  const to = vi.fn((_rooms: string[]) => ({ emit }));
  const socket = {
    id: 'socket-1',
    data: { userId },
    join: vi.fn(),
    leave: vi.fn(),
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    to,
  };
  return { socket, handlers, to, emit };
}

function buildService(memberIds: string[]) {
  const chat = {
    assertMembership: vi.fn().mockResolvedValue(undefined),
    getMemberUserIds: vi.fn().mockResolvedValue(memberIds),
  };
  const presence = { connect: vi.fn(), disconnect: vi.fn() };
  const service = new ChatRealtimeService(
    {} as JwtService,
    {} as PrismaService,
    chat as unknown as ChatService,
    presence as unknown as ChatPresenceService,
    {} as PushNotificationService,
  );
  return { service, chat };
}

/* Gọi `bindSocket` rồi lấy đúng handler cần thử, vì các handler chỉ tồn tại
   bên trong nó chứ không phải phương thức riêng. */
async function fireTyping(event: 'typing:start' | 'typing:stop', memberIds: string[]) {
  const sender = 'u-sender';
  const { service } = buildService(memberIds);
  const { socket, handlers, to, emit } = buildSocket(sender);

  (service as unknown as { bindSocket: (s: unknown) => void }).bindSocket(socket);
  await handlers.get(event)!({ channelId: 'c-1' });

  return { to, emit };
}

describe('typing:peer tới được cả người đang ở ngoài hội thoại', () => {
  it('bắn vào phòng riêng của từng thành viên khác, không chỉ phòng hội thoại', async () => {
    const { to } = await fireTyping('typing:start', ['u-sender', 'u-b', 'u-c']);

    expect(to).toHaveBeenCalledTimes(1);
    expect(to.mock.calls[0][0]).toEqual(['channel:c-1', 'user:u-b', 'user:u-c']);
  });

  /* Người gõ không cần nghe lại chính mình — và nếu bắn vào `user:<mình>`
     thì các thiết bị KHÁC của chính người đó sẽ hiện "đang soạn tin" về
     chính họ. */
  it('bỏ qua phòng riêng của người đang gõ', async () => {
    const { to } = await fireTyping('typing:start', ['u-sender', 'u-b']);

    expect(to.mock.calls[0][0]).not.toContain('user:u-sender');
  });

  it('gửi kèm cờ tắt khi ngừng gõ', async () => {
    const { emit } = await fireTyping('typing:stop', ['u-sender', 'u-b']);

    expect(emit).toHaveBeenCalledWith('typing:peer', {
      channelId: 'c-1',
      userId: 'u-sender',
      isTyping: false,
    });
  });

  it('gửi kèm cờ bật khi bắt đầu gõ', async () => {
    const { emit } = await fireTyping('typing:start', ['u-sender', 'u-b']);

    expect(emit).toHaveBeenCalledWith('typing:peer', {
      channelId: 'c-1',
      userId: 'u-sender',
      isTyping: true,
    });
  });
});
