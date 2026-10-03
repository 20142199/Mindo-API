import { ConflictException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole, UserStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { ChatPresenceService } from '../chat/chat-presence.service';
import { ChatRealtimeService } from '../chat/chat-realtime.service';
import { ChatService } from '../chat/chat.service';
import { PrismaService } from '../common/prisma.module';
import { PushNotificationService } from '../notification/push-notification.service';
import { FileStorageService } from '../phase1/file-storage.service';
import { FriendService } from './friend.service';

/**
 * Sự kiện `friend:updated` (2026-10-03).
 *
 * Thử trên hai máy thật: B bấm "Chấp nhận" mà danh bạ của A đứng im, phải kéo
 * để làm mới mới thấy bạn mới. Nguyên nhân là kết bạn chỉ ghi CSDL rồi trả về,
 * không báo cho ai. Giờ mỗi thao tác thành công phát một sự kiện vào phòng
 * `user:<id>` của CẢ HAI người — phòng của người bấm để các máy khác của chính
 * họ cũng cập nhật.
 *
 * Hai điều phải giữ:
 *   1. Chỉ phát SAU khi ghi xong. Thao tác hỏng (404, 409) thì không phát gì,
 *      nếu không app sẽ tải lại vô cớ — hoặc tệ hơn, tin rằng có thay đổi.
 *   2. Lỗi socket không được biến một thao tác đã ghi vào CSDL thành 500.
 */

const files = { view: () => ({ public_url: null }) } as unknown as FileStorageService;

const recipient = {
  id: 'u-ban',
  email: 'ban@mindo.test',
  fullName: 'Bạn',
  nickname: null,
  phone: null,
  avatarFileId: null,
  role: UserRole.INVESTOR,
  status: UserStatus.ACTIVE,
};

function setup(tx: Record<string, unknown> = {}, extra: Record<string, unknown> = {}, commitError?: Error) {
  const realtime = { publishFriendChanged: vi.fn() };
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    friendship: {
      findUnique: vi.fn().mockResolvedValue(null),
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    friendRequest: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    ...tx,
  };
  const prisma = {
    /* `commitError`: thân giao dịch chạy xong rồi mới hỏng lúc commit. */
    $transaction: async (work: (client: unknown) => unknown) => {
      const result = await work(transaction);
      if (commitError) throw commitError;
      return result;
    },
    user: { findUnique: vi.fn().mockResolvedValue(recipient) },
    fileUpload: { findMany: vi.fn().mockResolvedValue([]) },
    friendRequest: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    friendship: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    ...extra,
  } as unknown as PrismaService;
  const service = new FriendService(
    prisma,
    { ...files, assertOwned: vi.fn().mockResolvedValue({ id: 'f-1', mimeType: 'image/png' }) } as unknown as FileStorageService,
    realtime as unknown as ChatRealtimeService,
  );
  return { service, realtime, transaction };
}

describe('friend:updated — mỗi thao tác báo đúng người', () => {
  it('gửi lời mời: request_sent, người gửi → người nhận', async () => {
    const { service, realtime } = setup();
    await service.sendRequest('u-me', 'ban@mindo.test');
    expect(realtime.publishFriendChanged).toHaveBeenCalledTimes(1);
    expect(realtime.publishFriendChanged).toHaveBeenCalledWith('request_sent', 'u-me', 'u-ban');
  });

  it('chấp nhận: request_accepted, người nhận lời mời là người bấm', async () => {
    const { service, realtime } = setup({
      friendRequest: {
        findUnique: vi.fn().mockResolvedValue({ requester: { ...recipient, id: 'u-gui' } }),
        delete: vi.fn().mockResolvedValue({}),
      },
    });
    await service.accept('u-me', 'u-gui');
    expect(realtime.publishFriendChanged).toHaveBeenCalledTimes(1);
    expect(realtime.publishFriendChanged).toHaveBeenCalledWith('request_accepted', 'u-me', 'u-gui');
  });

  it('từ chối: request_rejected', async () => {
    const { service, realtime } = setup();
    await service.reject('u-me', 'u-gui');
    expect(realtime.publishFriendChanged).toHaveBeenCalledWith('request_rejected', 'u-me', 'u-gui');
  });

  it('huỷ lời mời đã gửi: request_cancelled', async () => {
    const { service, realtime } = setup();
    await service.cancel('u-me', 'u-ban');
    expect(realtime.publishFriendChanged).toHaveBeenCalledWith('request_cancelled', 'u-me', 'u-ban');
  });

  it('xoá bạn: friend_removed', async () => {
    const { service, realtime } = setup();
    await service.remove('u-me', 'u-ban');
    expect(realtime.publishFriendChanged).toHaveBeenCalledWith('friend_removed', 'u-me', 'u-ban');
  });
});

describe('friend:updated — thao tác hỏng thì không phát', () => {
  it('gửi lời mời cho người đã là bạn: 409 và im lặng', async () => {
    const { service, realtime } = setup({
      friendship: { findUnique: vi.fn().mockResolvedValue({ userId: 'u-me', friendUserId: 'u-ban' }) },
    });
    await expect(service.sendRequest('u-me', 'ban@mindo.test')).rejects.toBeInstanceOf(ConflictException);
    expect(realtime.publishFriendChanged).not.toHaveBeenCalled();
  });

  it('chấp nhận lời mời không còn: 404 và im lặng', async () => {
    const { service, realtime } = setup();
    await expect(service.accept('u-me', 'u-gui')).rejects.toBeInstanceOf(NotFoundException);
    expect(realtime.publishFriendChanged).not.toHaveBeenCalled();
  });

  it('từ chối / huỷ lời mời không còn: 404 và im lặng', async () => {
    const { service, realtime } = setup({}, {
      friendRequest: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    });
    await expect(service.reject('u-me', 'u-gui')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.cancel('u-me', 'u-ban')).rejects.toBeInstanceOf(NotFoundException);
    expect(realtime.publishFriendChanged).not.toHaveBeenCalled();
  });

  it('xoá người chưa phải bạn: 404 và im lặng', async () => {
    const { service, realtime } = setup({
      friendship: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    });
    await expect(service.remove('u-me', 'u-ban')).rejects.toBeInstanceOf(NotFoundException);
    expect(realtime.publishFriendChanged).not.toHaveBeenCalled();
  });

  /* Phần thân giao dịch chạy trót lọt nhưng COMMIT hỏng (Serializable xung đột,
     P2034). Không gì trong `work` ném lỗi, nên chỉ có test này giữ được bất biến
     "phát sau commit": ai đó dời `notify` vào trong callback là đỏ ngay. */
  it('thân giao dịch xong nhưng commit hỏng: ném lỗi và im lặng', async () => {
    const commitFailure = new Error('P2034: serialization failure');
    const { service, realtime } = setup(
      {
        friendRequest: {
          /* Hai lần đầu cho `sendRequest` (lời mời đi, lời mời đến): chưa có.
             Về sau cho `accept`: lời mời còn đó. */
          findUnique: vi
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValue({ requester: { ...recipient, id: 'u-gui' } }),
          create: vi.fn().mockResolvedValue({}),
          delete: vi.fn().mockResolvedValue({}),
        },
      },
      {},
      commitFailure,
    );
    await expect(service.sendRequest('u-me', 'ban@mindo.test')).rejects.toBe(commitFailure);
    await expect(service.accept('u-me', 'u-gui')).rejects.toBe(commitFailure);
    await expect(service.remove('u-me', 'u-ban')).rejects.toBe(commitFailure);
    expect(realtime.publishFriendChanged).not.toHaveBeenCalled();
  });

  /* Tên gợi nhớ và ảnh riêng là chuyện MỘT CHIỀU — người kia không được biết. */
  it('đặt tên gợi nhớ / ảnh riêng không phát gì', async () => {
    const { service, realtime } = setup();
    await service.setAlias('u-me', 'u-ban', 'Sếp');
    await service.setAvatar('u-me', 'u-ban', 'f-1');
    expect(realtime.publishFriendChanged).not.toHaveBeenCalled();
  });
});

describe('friend:updated — lỗi socket không làm hỏng thao tác', () => {
  it('đã ghi xong mà phát lỗi thì vẫn trả kết quả bình thường', async () => {
    const { service, realtime } = setup({
      friendRequest: {
        /* Lần đầu cho `accept`; về sau `sendRequest` phải thấy "chưa có lời mời". */
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ requester: { ...recipient, id: 'u-gui' } })
          .mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
      },
    });
    realtime.publishFriendChanged.mockImplementation(() => {
      throw new Error('socket hỏng');
    });

    await expect(service.accept('u-me', 'u-gui')).resolves.toMatchObject({ friend: { user_id: 'u-gui' } });
    await expect(service.remove('u-me', 'u-ban')).resolves.toEqual({ removed: true, user_id: 'u-ban' });
    await expect(service.reject('u-me', 'u-gui')).resolves.toEqual({ rejected: true, user_id: 'u-gui' });
    await expect(service.cancel('u-me', 'u-ban')).resolves.toEqual({ cancelled: true, user_id: 'u-ban' });
    await expect(service.sendRequest('u-me', 'ban@mindo.test')).resolves.toMatchObject({ user: { user_id: 'u-ban' } });
  });
});

describe('ChatRealtimeService.publishFriendChanged', () => {
  function realtimeWith(namespace?: unknown) {
    const service = new ChatRealtimeService(
      {} as JwtService,
      {} as PrismaService,
      {} as ChatService,
      {} as ChatPresenceService,
      {} as PushNotificationService,
    );
    (service as unknown as { namespace: unknown }).namespace = namespace;
    return service;
  }

  it('phát một gói duy nhất vào phòng của cả hai người', () => {
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    realtimeWith({ to }).publishFriendChanged('request_accepted', 'u-a', 'u-b');

    expect(to).toHaveBeenCalledTimes(1);
    expect(to).toHaveBeenCalledWith(['user:u-a', 'user:u-b']);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('friend:updated', {
      action: 'request_accepted',
      actor_user_id: 'u-a',
      target_user_id: 'u-b',
      at: expect.any(String),
    });
    const payload = emit.mock.calls[0][1] as { at: string };
    expect(Number.isNaN(Date.parse(payload.at))).toBe(false);
  });

  it('socket chưa khởi tạo thì không làm gì và không ném lỗi', () => {
    expect(() => realtimeWith(undefined).publishFriendChanged('friend_removed', 'u-a', 'u-b')).not.toThrow();
  });
});
