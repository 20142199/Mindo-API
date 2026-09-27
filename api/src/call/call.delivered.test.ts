import { ForbiddenException } from '@nestjs/common';
import { CallStatus, CallType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AgoraService } from './agora.service';
import { CallSignalingService } from './call-signaling.service';
import { CallService } from './call.service';
import { CallChatLogService } from './call-chat-log.service';
import { CallClient } from './call.dto';
import { PrismaService } from '../common/prisma.module';
import { FileStorageService } from '../phase1/file-storage.service';
import { PushNotificationService } from '../notification/push-notification.service';
import type { Queue } from 'bullmq';

/**
 * "Đang gọi…" -> "Đang đổ chuông…" (2026-09-28), như Messenger.
 *
 * Người gọi chỉ nên thấy "đang đổ chuông" khi máy bên kia THẬT SỰ đã nhận
 * được cuộc gọi. Máy người nhận báo điều đó bằng `POST /calls/:id/ringing`
 * ngay khi thấy cuộc gọi đến; server ghi `delivered_at`, và nhịp poll của
 * người gọi mang nó về.
 */

const user = (id: string) => ({
  id,
  fullName: `Người ${id}`,
  nickname: null,
  email: `${id}@example.test`,
  phone: null,
  avatarFileId: null,
});

const ME = 'u-me';
const PEER = 'u-ban';
const THIRD = 'u-nguoi-thu-ba';

function callRow(over: Partial<Record<string, unknown>> = {}) {
  const now = new Date();
  return {
    id: 'call-1',
    channelName: 'mindo-call-1',
    conversationId: null,
    callerId: PEER,
    calleeId: ME,
    callType: CallType.AUDIO,
    status: CallStatus.RINGING,
    endReason: null,
    ringingAt: now,
    deliveredAt: null,
    acceptedAt: null,
    endedAt: null,
    durationSec: 0,
    callerClient: null,
    calleeClient: null,
    createdAt: now,
    updatedAt: now,
    caller: user(PEER),
    callee: user(ME),
    ...over,
  };
}

function build(options: {
  busyRow?: ReturnType<typeof callRow> | null;
  ownRow?: ReturnType<typeof callRow>;
  others?: ReturnType<typeof callRow>[];
}) {
  type UpdateArgs = { where: { id: string }; data: Record<string, unknown> };
  const updateMany = vi.fn((_args: UpdateArgs) => Promise.resolve({ count: 1 }));
  const row = options.ownRow ?? callRow();
  const prisma = {
    call: {
      findUnique: () => Promise.resolve(row),
      findUniqueOrThrow: () => Promise.resolve(row),
      findFirst: () => Promise.resolve(options.busyRow ?? null),
      findMany: () => Promise.resolve(options.others ?? []),
      create: () => Promise.resolve(row),
      updateMany,
    },
    user: { findFirst: () => Promise.resolve({ id: PEER }) },
    fileUpload: { findMany: () => Promise.resolve([]) },
    $executeRaw: () => Promise.resolve(1),
    $transaction: (fn: (client: unknown) => Promise<unknown>) =>
      fn({
        $executeRaw: () => Promise.resolve(1),
        call: {
          findFirst: () => Promise.resolve(options.busyRow ?? null),
          create: () => Promise.resolve(row),
        },
      }),
  } as unknown as PrismaService;

  const service = new CallService(
    prisma,
    { mediaCredentials: () => ({ rtc_token: 'x' }) } as unknown as AgoraService,
    { isConfigured: () => false, publish: () => Promise.resolve(false) } as unknown as CallSignalingService,
    {} as FileStorageService,
    { notifyIncomingCall: vi.fn(() => Promise.resolve()) } as unknown as PushNotificationService,
    /* Nhật ký cuộc gọi trong chat — thêm sau bộ test này. Nó chạy ngoài
       luồng (`void`) và không nằm trong đường đi nào ở đây, nên chỉ cần một
       bản rỗng để dựng được. */
    { record: vi.fn(() => Promise.resolve()) } as unknown as CallChatLogService,
    { add: vi.fn(() => Promise.resolve({ id: 'job' })) } as unknown as Queue<{ callId: string }>,
  );
  return { service, updateMany };
}

describe('máy người nhận báo đã đổ chuông', () => {
  it('ghi delivered_at cho cuộc gọi đang đổ chuông', async () => {
    const { service, updateMany } = build({});

    await service.markRinging(ME, 'call-1');

    expect(updateMany).toHaveBeenCalledTimes(1);
    const [args] = updateMany.mock.calls[0];
    /* Điều kiện nằm TRONG câu update: hai máy cùng báo, hay cuộc gọi vừa
       được nghe giữa lúc đó, thì không ghi đè mốc cũ / không ghi nhầm. */
    expect(args.where).toMatchObject({ id: 'call-1', status: CallStatus.RINGING, deliveredAt: null });
    expect(args.data.deliveredAt).toBeInstanceOf(Date);
  });

  it('người GỌI không báo thay được', async () => {
    const { service, updateMany } = build({ ownRow: callRow({ callerId: ME, calleeId: PEER }) });

    await expect(service.markRinging(ME, 'call-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('đã báo rồi thì không ghi lại — mốc giữ lần đầu', async () => {
    const { service, updateMany } = build({ ownRow: callRow({ deliveredAt: new Date('2026-09-28T00:00:00Z') }) });

    await service.markRinging(ME, 'call-1');

    expect(updateMany).not.toHaveBeenCalled();
  });

  /* Máy báo trễ sau khi đã nghe / đã huỷ: không lỗi, chỉ là không còn gì
     để báo. Trả lỗi ở đây chỉ làm app ồn ào vô cớ. */
  it('cuộc gọi không còn đổ chuông thì bỏ qua, không lỗi', async () => {
    const { service, updateMany } = build({ ownRow: callRow({ status: CallStatus.ACCEPTED }) });

    await expect(service.markRinging(ME, 'call-1')).resolves.toBeDefined();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('view trả delivered_at để người gọi biết', async () => {
    const at = new Date('2026-09-28T01:02:03Z');
    const { service } = build({ ownRow: callRow({ callerId: ME, calleeId: PEER, deliveredAt: at }) });

    const view = await service.get(ME, 'call-1');

    expect(view.delivered_at).toBe(at.toISOString());
  });
});
