import { describe, expect, it, vi } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma.module';
import { ChatRealtimeService } from './chat-realtime.service';
import { ChatService } from './chat.service';
import { ChatPresenceService } from './chat-presence.service';
import { PushNotificationService } from '../notification/push-notification.service';

/**
 * Chấm "đang hoạt động" phải TỰ đổi, không đợi tải lại (2026-09-27).
 *
 * Trước đây `is_online` chỉ tới cùng phản hồi REST. Người kia đóng app thì
 * chấm xanh trên máy mình vẫn sáng cho tới khi có cớ gì đó khiến danh sách
 * được nạp lại — có thể là vài phút, có thể là không bao giờ. Không có sự
 * kiện `presence:*` nào trong cả hệ thống.
 *
 * Hai điều dễ làm sai, nên khoá lại ở đây:
 *
 *   1. MỘT NGƯỜI, NHIỀU THIẾT BỊ. Mở app trên điện thoại rồi mở thêm trên
 *      iPad là hai socket. Bắn "vừa online" hai lần thì không sao, nhưng
 *      đóng MỘT trong hai mà báo "đã offline" thì sai hẳn — người ta vẫn
 *      đang ngồi đó với máy kia.
 *   2. MỐC LẦN CUỐI chỉ ghi khi socket CUỐI CÙNG rời đi, vì trước đó họ
 *      vẫn đang online.
 */

type Handler = (payload: unknown, ack?: (res: unknown) => void) => Promise<void>;

function buildSocket(userId: string, socketId = 'socket-1') {
  const handlers = new Map<string, Handler>();
  const socket = {
    id: socketId,
    data: { userId },
    join: vi.fn(),
    leave: vi.fn(),
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    to: vi.fn(() => ({ emit: vi.fn() })),
  };
  return { socket, handlers };
}

function buildService(options: {
  peerIds?: string[];
  firstSocket?: boolean;
  wasLast?: boolean;
  lastSeenAt?: string | null;
  peersThrow?: boolean;
}) {
  const emit = vi.fn();
  const to = vi.fn((_rooms: string[]) => ({ emit }));

  const chat = {
    assertMembership: vi.fn().mockResolvedValue(undefined),
    getMemberUserIds: vi.fn().mockResolvedValue([]),
    getPeerUserIds: options.peersThrow
      ? vi.fn().mockRejectedValue(new Error('CSDL lỗi'))
      : vi.fn().mockResolvedValue(options.peerIds ?? []),
  };

  const presence = {
    connect: vi.fn().mockResolvedValue(options.firstSocket ?? true),
    disconnect: vi.fn().mockResolvedValue({
      wasLast: options.wasLast ?? true,
      lastSeenAt: options.lastSeenAt ?? '2026-09-27T01:00:00.000Z',
    }),
  };

  const service = new ChatRealtimeService(
    {} as JwtService,
    {} as PrismaService,
    chat as unknown as ChatService,
    presence as unknown as ChatPresenceService,
    {} as PushNotificationService,
  );
  /*
    Tiêm vào `namespace`, KHÔNG phải `io`.

    Bản đầu của test này tiêm `io` và xanh hết — trong khi trên máy thật
    không một sự kiện nào tới nơi. `this.io` là namespace GỐC, còn client
    nối vào `/chat` tức `this.namespace`. Bắn nhầm chỗ thì Socket.IO im
    lặng: không lỗi, không cảnh báo, chỉ là không ai nghe thấy.
  */
  (service as unknown as { namespace: unknown }).namespace = { to };

  return { service, chat, presence, to, emit };
}

/** `bindSocket` là nơi duy nhất gắn các handler, nên phải đi qua nó. */
function bind(service: ChatRealtimeService, socket: unknown) {
  (service as unknown as { bindSocket: (s: unknown) => void }).bindSocket(socket);
}

/* Fan-out chạy ngoài luồng (`void`) nên phải nhường vài nhịp microtask. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('presence:updated khi vào mạng', () => {
  it('socket đầu tiên báo online cho mọi người có chung hội thoại', async () => {
    const { service, to, emit } = buildService({ peerIds: ['u-b', 'u-c'] });
    const { socket } = buildSocket('u-me');

    bind(service, socket);
    await settle();

    expect(to).toHaveBeenCalledWith(['user:u-b', 'user:u-c']);
    expect(emit).toHaveBeenCalledWith('presence:updated', {
      user_id: 'u-me',
      is_online: true,
      last_seen_at: null,
    });
  });

  /* Mở thêm iPad trong lúc điện thoại vẫn mở: không có gì mới để báo. */
  it('socket thứ hai của cùng người thì im lặng', async () => {
    const { service, to } = buildService({ peerIds: ['u-b'], firstSocket: false });
    const { socket } = buildSocket('u-me', 'socket-2');

    bind(service, socket);
    await settle();

    expect(to).not.toHaveBeenCalled();
  });

  /* Chưa nhắn với ai thì không ai cần biết mình vừa online. */
  it('không có ai chung hội thoại thì không bắn', async () => {
    const { service, to } = buildService({ peerIds: [] });
    const { socket } = buildSocket('u-me');

    bind(service, socket);
    await settle();

    expect(to).not.toHaveBeenCalled();
  });
});

describe('presence:updated khi rời mạng', () => {
  it('socket cuối cùng báo offline kèm mốc lần cuối', async () => {
    const { service, emit } = buildService({
      peerIds: ['u-b'],
      wasLast: true,
      lastSeenAt: '2026-09-27T01:23:45.000Z',
    });
    const { socket, handlers } = buildSocket('u-me');

    bind(service, socket);
    await settle();
    emit.mockClear();

    await handlers.get('disconnect')!(undefined);
    await settle();

    expect(emit).toHaveBeenCalledWith('presence:updated', {
      user_id: 'u-me',
      is_online: false,
      last_seen_at: '2026-09-27T01:23:45.000Z',
    });
  });

  /* Đóng điện thoại nhưng iPad còn mở — người ta vẫn đang online. */
  it('còn thiết bị khác đang mở thì không báo offline', async () => {
    const { service, emit } = buildService({ peerIds: ['u-b'], wasLast: false });
    const { socket, handlers } = buildSocket('u-me');

    bind(service, socket);
    await settle();
    emit.mockClear();

    await handlers.get('disconnect')!(undefined);
    await settle();

    expect(emit).not.toHaveBeenCalled();
  });
});

describe('fan-out hỏng không được kéo theo vòng đời socket', () => {
  it('truy vấn danh sách người quen ném lỗi thì vẫn vào phòng bình thường', async () => {
    const { service } = buildService({ peersThrow: true });
    const { socket } = buildSocket('u-me');

    expect(() => bind(service, socket)).not.toThrow();
    await settle();

    expect(socket.join).toHaveBeenCalledWith('user:u-me');
  });

  /* Handler `disconnect` là hàm ĐỒNG BỘ bắn việc ra nền, nên lỗi ở trong
     không quay lại chỗ gọi được — nó chỉ có thể thành unhandled rejection.
     Ca này khoá đúng điều đó: gọi xong, chờ lắng, không có gì nổ. */
  it('lỗi lúc ngắt kết nối không nổi lên thành unhandled rejection', async () => {
    const { service, emit } = buildService({ peersThrow: true });
    const { socket, handlers } = buildSocket('u-me');
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    bind(service, socket);
    await settle();
    expect(() => handlers.get('disconnect')!(undefined)).not.toThrow();
    await settle();

    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  /* Redis chết thì `presence.disconnect` ném — nhánh try/catch NGOÀI cùng. */
  it('presence service ném lỗi cũng không nổ', async () => {
    const { service, presence } = buildService({ peerIds: ['u-b'] });
    presence.disconnect.mockRejectedValue(new Error('Redis chết'));
    const { socket, handlers } = buildSocket('u-me');
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    bind(service, socket);
    await settle();
    expect(() => handlers.get('disconnect')!(undefined)).not.toThrow();
    await settle();

    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
