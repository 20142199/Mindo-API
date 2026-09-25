import { ConflictException } from '@nestjs/common';
import { CallStatus, CallType } from '@prisma/client';
import { Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../common/prisma.module';
import { FileStorageService } from '../phase1/file-storage.service';
import { AgoraService } from './agora.service';
import { CallSignalingService } from './call-signaling.service';
import { PushNotificationService } from '../notification/push-notification.service';
import { CallClient } from './call.dto';
import { CallService } from './call.service';

/**
 * Safety net for the ringing-timeout recovery WIRING (2026-09-24).
 *
 * `call.domain.test.ts` covers the rule; this file covers the fact that the
 * rule is consulted at all. The two need to be separate, because the rule can
 * stay perfectly correct while nothing calls it — which is precisely the bug
 * being fixed here. Before this pass `markExpiredRingingCalls` existed and
 * was right, but `get` never ran it, and `get` is the only endpoint the
 * in-call screen polls.
 *
 * The recovery lives in `ownedCall`, so it covers every route into a single
 * call: read it, accept it, reject it, end it, refresh its token.
 */

const users = {
  caller: { id: 'user-caller', fullName: 'Người gọi', avatarFileId: null },
  callee: { id: 'user-callee', fullName: 'Người nhận', avatarFileId: null },
};

function ringingCall(ringingAt: Date) {
  return {
    id: 'call-1',
    channelName: 'mindo-call-1',
    conversationId: null,
    callerId: users.caller.id,
    calleeId: users.callee.id,
    callType: CallType.AUDIO,
    status: CallStatus.RINGING,
    endReason: null,
    ringingAt,
    acceptedAt: null,
    endedAt: null,
    durationSec: 0,
    callerClient: null,
    calleeClient: null,
    createdAt: ringingAt,
    updatedAt: ringingAt,
    caller: users.caller,
    callee: users.callee,
  };
}

function buildService(row: ReturnType<typeof ringingCall>) {
  const trail: string[] = [];

  const updateMany = vi.fn((_args: { where: unknown; data: Record<string, unknown> }) => {
    trail.push('sweep');
    return Promise.resolve({ count: 1 });
  });

  const prisma = {
    call: {
      findUnique: () => Promise.resolve(row),
      findUniqueOrThrow: () => Promise.resolve(row),
      findFirst: () => {
        trail.push('busy-check');
        return Promise.resolve(null);
      },
      create: () => Promise.resolve(row),
      updateMany,
    },
    user: { findFirst: () => Promise.resolve({ id: users.callee.id }) },
    fileUpload: { findMany: () => Promise.resolve([]) },
    $executeRaw: () => Promise.resolve(1),
    $transaction: (fn: (client: unknown) => Promise<unknown>) =>
      fn({
        $executeRaw: () => Promise.resolve(1),
        call: {
          findFirst: () => {
            trail.push('busy-check');
            return Promise.resolve(null);
          },
          create: () => Promise.resolve(row),
        },
      }),
  } as unknown as PrismaService;

  const service = new CallService(
    prisma,
    { mediaCredentials: () => ({ rtc_token: 'x' }) } as unknown as AgoraService,
    { isConfigured: () => false, publish: () => Promise.resolve(false) } as unknown as CallSignalingService,
    {} as FileStorageService,
    /* Push đã được thêm vào service sau khi bộ test này ra đời. Nó không nằm
       trong đường đi nào ở đây, nên chỉ cần một bản rỗng để dựng được. */
    { notifyIncomingCall: vi.fn(() => Promise.resolve()) } as unknown as PushNotificationService,
    { add: vi.fn(() => Promise.resolve({ id: 'job' })) } as unknown as Queue<{ callId: string }>,
  );

  return { service, updateMany, trail };
}

const longAgo = () => new Date(Date.now() - 10 * 60_000);
const justNow = () => new Date(Date.now() - 2_000);

describe('a forgotten ringing call heals on read', () => {
  it('reports MISSED instead of ringing forever', async () => {
    const { service, updateMany } = buildService(ringingCall(longAgo()));

    const view = await service.get(users.caller.id, 'call-1');

    expect(view.status).toBe(CallStatus.MISSED);
    expect(view.end_reason).toBe('timeout_recovery');
    expect(updateMany).toHaveBeenCalledOnce();
  });

  /*
    The reason it is `timeout_recovery` and not `timeout`: reading the column
    later has to tell you whether the scheduled job ran or whether a read had
    to cover for it. Collapsing the two hides a dead queue.
  */
  it('keeps its own end reason apart from the job’s', async () => {
    const { service, updateMany } = buildService(ringingCall(longAgo()));

    await service.get(users.caller.id, 'call-1');

    expect(updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'call-1', status: CallStatus.RINGING },
      data: { status: CallStatus.MISSED, endReason: 'timeout_recovery' },
    });
  });

  it('writes nothing while the call is still genuinely ringing', async () => {
    const { service, updateMany } = buildService(ringingCall(justNow()));

    const view = await service.get(users.caller.id, 'call-1');

    expect(view.status).toBe(CallStatus.RINGING);
    expect(updateMany).not.toHaveBeenCalled();
  });

  /*
    Reading is the mild half. This is the sharp one: without the recovery the
    callee could still pick up a call the caller walked away from minutes ago,
    and land in an empty Agora channel.
  */
  it('refuses to accept a call that has already timed out', async () => {
    const { service } = buildService(ringingCall(longAgo()));

    await expect(service.accept(users.callee.id, 'call-1', CallClient.APP))
      .rejects.toThrow(ConflictException);
  });

  it('still accepts a call that is ringing right now', async () => {
    const { service } = buildService(ringingCall(justNow()));

    await expect(service.accept(users.callee.id, 'call-1', CallClient.APP)).resolves.toBeDefined();
  });
});

describe('a forgotten ringing call does not brick new calls', () => {
  /*
    A stale RINGING row sits inside ACTIVE_CALL_STATUSES, so the busy check in
    `initiate` reads it as "one of these two is on another call" and answers
    CALL_BUSY. With the timer job lost, that verdict never expires: both
    people are locked out of calling anyone, permanently.
  */
  it('sweeps before asking who is busy', async () => {
    const { service, trail } = buildService(ringingCall(longAgo()));

    await service.initiate(users.caller.id, { callee_user_id: users.callee.id, call_type: CallType.AUDIO } as never);

    expect(trail).toEqual(['sweep', 'busy-check']);
  });
});
