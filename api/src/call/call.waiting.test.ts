import { ConflictException } from '@nestjs/common';
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
 * Cuộc gọi CHỜ: gọi cho người đang bận (2026-09-27).
 *
 * Trước đây server chặn cả hai phía — người nhận đang nói chuyện thì mọi cuộc
 * gọi tới đều bị trả `CALL_BUSY` ngay, và máy họ không hề biết có ai vừa gọi.
 * Messenger để cuộc thứ hai đổ chuông rồi cho người nhận tự chọn; họ đang cầm
 * máy trong tay, quyết định đó là của họ.
 *
 * Người GỌI thì vẫn bị chặn: đang trong một cuộc mà bấm gọi người khác là
 * thao tác nhầm.
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

describe('gọi cho người đang bận', () => {
  it('vẫn tạo được cuộc gọi — máy người kia sẽ đổ chuông', async () => {
    /* Không có cuộc nào của CHÍNH người gọi, nên `findFirst` trả null. */
    const { service } = build({});

    await expect(
      service.initiate(ME, { callee_user_id: PEER, call_type: CallType.AUDIO } as never),
    ).resolves.toBeDefined();
  });

  /* Còn mình đang bận thì không: bấm gọi lúc đang nói chuyện là nhầm tay. */
  it('người GỌI đang bận thì bị chặn', async () => {
    const { service } = build({ busyRow: callRow({ status: CallStatus.ACCEPTED }) });

    await expect(
      service.initiate(ME, { callee_user_id: PEER, call_type: CallType.AUDIO } as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('nhận cuộc gọi chờ', () => {
  it('gác cuộc đang nói, đánh dấu COMPLETED', async () => {
    const talking = callRow({ id: 'call-dang-noi', status: CallStatus.ACCEPTED });
    const { service, updateMany } = build({ others: [talking] });

    await service.accept(ME, 'call-1', CallClient.APP);

    const written = updateMany.mock.calls.find(
      ([args]) => args.where.id === 'call-dang-noi',
    );
    expect(written).toBeDefined();
    expect(written?.[0].data).toMatchObject({
      status: CallStatus.COMPLETED,
      endReason: 'switched_call',
    });
  });

  /* Cuộc thứ ba mới chỉ đổ chuông thì là NHỠ, không phải bị từ chối: người
     dùng không hề từ chối ai, họ chỉ chọn một cuộc khác. */
  it('cuộc đang đổ chuông khác thành MISSED', async () => {
    const ringing = callRow({ id: 'call-thu-ba', callerId: THIRD, status: CallStatus.RINGING });
    const { service, updateMany } = build({ others: [ringing] });

    await service.accept(ME, 'call-1', CallClient.APP);

    const written = updateMany.mock.calls.find(
      ([args]) => args.where.id === 'call-thu-ba',
    );
    expect(written?.[0].data).toMatchObject({
      status: CallStatus.MISSED,
      endReason: 'missed_while_busy',
    });
  });

  it('không có cuộc nào khác thì không đụng gì thêm', async () => {
    const { service, updateMany } = build({ others: [] });

    await service.accept(ME, 'call-1', CallClient.APP);

    /* Chỉ đúng một lần ghi: chính cuộc vừa nhận */
    expect(updateMany).toHaveBeenCalledOnce();
  });
});

/**
 * Chuyển cuộc gọi thoại đang nói sang video (2026-09-27).
 *
 * Không ai phải đổ chuông lại: hai người đã ở trong cùng một kênh Agora, bật
 * camera chỉ là mở thêm luồng hình. Server chỉ đổi nhãn `callType`, và hai máy
 * thấy nó qua nhịp poll rồi tự bật camera.
 */
describe('chuyển sang gọi video', () => {
  it('đổi nhãn cuộc gọi thành VIDEO', async () => {
    const talking = callRow({ status: CallStatus.ACCEPTED });
    const { service, updateMany } = build({ ownRow: talking });

    await service.upgradeToVideo(ME, 'call-1');

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'call-1', status: CallStatus.ACCEPTED },
      data: { callType: CallType.VIDEO },
    });
  });

  /* Đang đổ chuông thì chưa có kênh nào để bật camera. */
  it('cuộc gọi chưa được nhận thì từ chối', async () => {
    const { service } = build({ ownRow: callRow({ status: CallStatus.RINGING }) });

    await expect(service.upgradeToVideo(ME, 'call-1')).rejects.toBeInstanceOf(ConflictException);
  });

  /* Hai người cùng bấm một lúc: người sau không nên nhận lỗi, vì kết quả họ
     muốn đã có rồi. */
  it('đã là video rồi thì không coi là lỗi', async () => {
    const { service, updateMany } = build({
      ownRow: callRow({ status: CallStatus.ACCEPTED, callType: CallType.VIDEO }),
    });

    await expect(service.upgradeToVideo(ME, 'call-1')).resolves.toBeDefined();
    expect(updateMany).not.toHaveBeenCalled();
  });
});
