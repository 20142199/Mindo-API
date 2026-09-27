import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Call, CallStatus, CallType, FileUpload, Prisma, UserRole, UserStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { pageExtra } from '../common/api-response';
import { PrismaService } from '../common/prisma.module';
import { PushNotificationService } from '../notification/push-notification.service';
import { FileStorageService } from '../phase1/file-storage.service';
import { AgoraService } from './agora.service';
import { CALL_TIMEOUT_QUEUE } from './call.constants';
import { CallClient, CallDirection, CallEndReason, CallHistoryQueryDto, InitiateCallDto } from './call.dto';
import {
  ACTIVE_CALL_STATUSES,
  callDurationSeconds,
  callStatusLabels,
  isRingingExpired,
  isTerminalCallStatus,
  resolveRingingTimeoutMs,
} from './call.domain';
import { CallSignalKind, CallSignalingService } from './call-signaling.service';

const RINGING_TIMEOUT_MS = resolveRingingTimeoutMs(process.env.CALL_RINGING_TIMEOUT_MS);

type CallWithUsers = Prisma.CallGetPayload<{ include: { caller: true; callee: true } }>;

@Injectable()
export class CallService {
  private readonly logger = new Logger(CallService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agora: AgoraService,
    private readonly signaling: CallSignalingService,
    private readonly files: FileStorageService,
    private readonly push: PushNotificationService,
    @InjectQueue(CALL_TIMEOUT_QUEUE) private readonly timeoutQueue: Queue<{ callId: string }>,
  ) {}

  async initiate(callerId: string, dto: InitiateCallDto) {
    if (callerId === dto.callee_user_id) throw new BadRequestException('Không thể tự gọi chính mình');
    const callee = await this.prisma.user.findFirst({
      where: { id: dto.callee_user_id, role: UserRole.INVESTOR, status: UserStatus.ACTIVE },
      select: { id: true },
    });
    if (!callee) throw new NotFoundException('Không tìm thấy người nhận cuộc gọi');

    /* Trước khi hỏi "ai đang bận": một cuộc gọi quá hạn mà chưa ai đóng vẫn
       nằm trong `ACTIVE_CALL_STATUSES`, nên nó sẽ khoá cả hai người khỏi mọi
       cuộc gọi mới bằng `CALL_BUSY` — vĩnh viễn, nếu job hẹn giờ đã mất. */
    await this.markExpiredRingingCalls();

    const callId = randomUUID();
    const channelName = `mindo-call-${callId}`;
    const media = this.agora.mediaCredentials(channelName, callerId, dto.client_platform);
    const row = await this.prisma.$transaction(async (tx) => {
      for (const userId of [callerId, callee.id].sort()) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mindo-call:${userId}`}))`;
      }
      /*
        Chỉ NGƯỜI GỌI bận mới bị chặn.

        Trước đây chặn cả hai phía: người nhận đang nói chuyện với ai đó thì
        mọi cuộc gọi tới đều bị từ chối thẳng ở server, và máy họ không hề hay
        biết có ai vừa gọi. Messenger thì để cuộc gọi thứ hai đổ chuông và cho
        người nhận tự quyết — đó cũng là điều người dùng chờ đợi, vì họ đang
        cầm máy trong tay.

        Còn người GỌI thì vẫn chặn: đang trong một cuộc gọi mà bấm gọi người
        khác là thao tác nhầm, không phải ý định.
      */
      const busy = await tx.call.findFirst({
        where: {
          status: { in: ACTIVE_CALL_STATUSES },
          OR: [{ callerId }, { calleeId: callerId }],
        },
        select: { id: true, status: true },
      });
      if (busy) {
        throw new ConflictException({ message: 'Bạn đang có cuộc gọi khác', code: 'CALL_BUSY', call_id: busy.id });
      }

      /* Người nhận đang bận thì cuộc gọi này là cuộc gọi CHỜ. Không chặn,
         nhưng cũng không để một người bị đổ chuông dồn dập: đã có cuộc nào
         đang đổ chuông từ chính mình tới họ thì trả lại cuộc đó. */
      const duplicate = await tx.call.findFirst({
        where: { callerId, calleeId: callee.id, status: CallStatus.RINGING },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException({ message: 'Bạn đang gọi người này', code: 'CALL_BUSY', call_id: duplicate.id });
      }
      return tx.call.create({
        data: {
          id: callId,
          channelName,
          conversationId: dto.conversation_id,
          callerId,
          calleeId: callee.id,
          callType: dto.call_type,
          callerClient: dto.client_platform,
        },
        include: { caller: true, callee: true },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    try {
      await this.timeoutQueue.add(
        'expire-ringing-call',
        { callId },
        { jobId: `call-timeout-${callId}`, delay: RINGING_TIMEOUT_MS, removeOnComplete: 100, removeOnFail: 100 },
      );
    } catch (error) {
      /* Cố tình đi tiếp: mất hẹn giờ không đáng để mất luôn cuộc gọi. An
         toàn vì `expireIfStale` và `markExpiredRingingCalls` sẽ đóng hộ ở
         lần đọc kế tiếp — xem `isRingingExpired` trong `call.domain.ts`. */
      this.logger.error(`Không đặt được timeout cho cuộc gọi ${callId}: ${error instanceof Error ? error.message : String(error)}`);
    }

    const view = await this.view(row, callerId);
    const signal = this.signalPayload(row, 'call.invite');
    void this.signaling.publish({ toUserId: row.calleeId, fromUserId: row.callerId, kind: 'call.invite', payload: signal });
    void this.push.notifyIncomingCall(row.calleeId, {
      callId: row.id,
      callerUserId: row.callerId,
      callerName: row.caller.nickname ?? row.caller.fullName,
      callType: row.callType,
      conversationId: row.conversationId,
    }).catch((error) => {
      this.logger.warn(`Không gửi được push cuộc gọi ${row.id}: ${error instanceof Error ? error.message : String(error)}`);
    });
    return {
      call: view,
      media,
      signaling: {
        server_delivery_enabled: this.signaling.isConfigured(),
        recipient_uid: row.calleeId,
        event: 'call.invite',
        payload: signal,
      },
    };
  }

  async rtmToken(userId: string, client: CallClient) {
    return this.agora.rtmCredentials(userId, client);
  }

  async incoming(userId: string) {
    await this.markExpiredRingingCalls();
    const row = await this.prisma.call.findFirst({
      where: { calleeId: userId, status: CallStatus.RINGING },
      include: { caller: true, callee: true },
      orderBy: { ringingAt: 'desc' },
    });
    return row ? this.view(row, userId) : null;
  }

  async active(userId: string) {
    await this.markExpiredRingingCalls();
    const row = await this.prisma.call.findFirst({
      where: { status: { in: ACTIVE_CALL_STATUSES }, OR: [{ callerId: userId }, { calleeId: userId }] },
      include: { caller: true, callee: true },
      /*
        Cuộc ĐANG NÓI đứng trước cuộc đang đổ chuông.

        Từ khi người nhận bận vẫn được đổ chuông, một người có thể có hai
        cuộc cùng sống. `createdAt desc` sẽ trả cuộc chờ — nghĩa là dải băng
        "đang trong cuộc gọi" chỉ vào nhầm cuộc, và app tưởng mình đang nói
        chuyện với người vừa gọi tới.

        `status desc` cho ACCEPTED lên trước RINGING, vì Postgres sắp enum
        theo thứ tự KHAI BÁO và trong `schema.prisma` thì RINGING đứng trước
        ACCEPTED.
      */
      orderBy: [{ status: 'desc' }, { createdAt: 'desc' }],
    });
    return row ? this.view(row, userId) : null;
  }

  async get(userId: string, callId: string) {
    return this.view(await this.ownedCall(userId, callId), userId);
  }

  async refreshMediaToken(userId: string, callId: string, client: CallClient) {
    const row = await this.ownedCall(userId, callId);
    if (!ACTIVE_CALL_STATUSES.includes(row.status)) throw new ConflictException('Cuộc gọi đã kết thúc');
    return {
      call_id: row.id,
      call_type: row.callType,
      media: this.agora.mediaCredentials(row.channelName, userId, client),
    };
  }

  async accept(userId: string, callId: string, client: CallClient) {
    const current = await this.ownedCall(userId, callId);
    if (current.calleeId !== userId) throw new ForbiddenException('Bạn không phải người nhận cuộc gọi này');
    if (current.status !== CallStatus.RINGING) throw new ConflictException('Cuộc gọi không còn ở trạng thái đổ chuông');

    /*
      Nhận cuộc gọi chờ thì GÁC cuộc đang nói.

      Một người chỉ ở trong một kênh RTC tại một thời điểm, nên nhận cuộc mới
      mà để cuộc cũ nguyên đó sẽ tạo ra một cuộc gọi ma: bên kia vẫn thấy
      "đang nói chuyện" trong khi không còn ai nghe. Gác hộ ở đây, và người
      kia nhận `call.end` như một cuộc gọi kết thúc bình thường.

      Cũng dọn luôn các cuộc ĐANG ĐỔ CHUÔNG khác tới mình: đã chọn một cuộc
      thì những cuộc còn lại là nhỡ.
    */
    await this.hangUpOtherCalls(userId, callId);

    const media = this.agora.mediaCredentials(current.channelName, userId, client);
    const result = await this.prisma.call.updateMany({
      where: { id: callId, calleeId: userId, status: CallStatus.RINGING },
      data: { status: CallStatus.ACCEPTED, acceptedAt: new Date(), calleeClient: client },
    });
    if (result.count !== 1) throw new ConflictException('Cuộc gọi không còn ở trạng thái đổ chuông');
    const row = await this.ownedCall(userId, callId);
    const signal = this.signalPayload(row, 'call.accept');
    void this.signaling.publish({ toUserId: row.callerId, fromUserId: userId, kind: 'call.accept', payload: signal });
    return {
      call: await this.view(row, userId),
      media,
      signaling: { server_delivery_enabled: this.signaling.isConfigured(), recipient_uid: row.callerId, event: 'call.accept', payload: signal },
    };
  }

  /**
   * Kết thúc mọi cuộc gọi còn sống khác của `userId`, trừ `keepCallId`.
   *
   * Dùng khi người này nhận một cuộc gọi chờ. Cuộc đang nói thành
   * `COMPLETED` (nó đã diễn ra thật), cuộc mới chỉ đổ chuông thì thành
   * `MISSED` — không phải `REJECTED`, vì người dùng không hề từ chối ai, họ
   * chỉ chọn một cuộc khác.
   */
  private async hangUpOtherCalls(userId: string, keepCallId: string) {
    const others = await this.prisma.call.findMany({
      where: {
        id: { not: keepCallId },
        status: { in: ACTIVE_CALL_STATUSES },
        OR: [{ callerId: userId }, { calleeId: userId }],
      },
      include: { caller: true, callee: true },
    });
    const now = new Date();
    for (const other of others) {
      const accepted = other.status === CallStatus.ACCEPTED;
      await this.prisma.call.updateMany({
        where: { id: other.id, status: other.status },
        data: {
          status: accepted ? CallStatus.COMPLETED : CallStatus.MISSED,
          endedAt: now,
          endReason: accepted ? 'switched_call' : 'missed_while_busy',
        },
      });
      const peerId = other.callerId === userId ? other.calleeId : other.callerId;
      const signal = this.signalPayload(other, accepted ? 'call.end' : 'call.missed');
      void this.signaling.publish({
        toUserId: peerId,
        fromUserId: userId,
        kind: accepted ? 'call.end' : 'call.missed',
        payload: signal,
      });
    }
  }

  /**
   * Nâng một cuộc gọi thoại ĐANG NÓI lên gọi video.
   *
   * Không tạo cuộc gọi mới và không ai phải đổ chuông lại: hai người đã ở
   * trong cùng một kênh Agora, bật camera chỉ là mở thêm luồng hình trên
   * chính kênh đó. Ở đây chỉ đổi nhãn `callType`, và cả hai máy thấy nó qua
   * nhịp poll `GET /calls/:id` rồi tự bật camera.
   *
   * Đổi nhãn chứ không giữ AUDIO: lịch sử phải nói đúng cái đã diễn ra ở phần
   * lớn cuộc gọi, và chính `call_type` là thứ hai màn hình dùng để đồng bộ
   * với nhau.
   *
   * AI CŨNG GỌI ĐƯỢC, không riêng người khởi xướng: trong một cuộc gọi thoại,
   * ai muốn cho người kia nhìn thấy mình cũng là chuyện bình thường.
   */
  async upgradeToVideo(userId: string, callId: string) {
    const current = await this.ownedCall(userId, callId);
    if (current.status !== CallStatus.ACCEPTED) {
      throw new ConflictException('Chỉ chuyển sang video khi đang trong cuộc gọi');
    }
    if (current.callType === CallType.VIDEO) {
      /* Người kia vừa bấm trước — không phải lỗi, chỉ là đã xong rồi. */
      return this.view(current, userId);
    }
    await this.prisma.call.updateMany({
      where: { id: callId, status: CallStatus.ACCEPTED },
      data: { callType: CallType.VIDEO },
    });
    const row = await this.ownedCall(userId, callId);
    const peerId = row.callerId === userId ? row.calleeId : row.callerId;
    const signal = this.signalPayload(row, 'call.upgrade');
    void this.signaling.publish({ toUserId: peerId, fromUserId: userId, kind: 'call.upgrade', payload: signal });
    return this.view(row, userId);
  }

  async reject(userId: string, callId: string) {
    const current = await this.ownedCall(userId, callId);
    if (current.calleeId !== userId) throw new ForbiddenException('Bạn không phải người nhận cuộc gọi này');
    if (current.status !== CallStatus.RINGING) throw new ConflictException('Cuộc gọi không còn ở trạng thái đổ chuông');
    const result = await this.prisma.call.updateMany({
      where: { id: callId, calleeId: userId, status: CallStatus.RINGING },
      data: { status: CallStatus.REJECTED, endedAt: new Date(), endReason: 'callee_reject' },
    });
    if (result.count !== 1) throw new ConflictException('Cuộc gọi không còn ở trạng thái đổ chuông');
    const row = await this.ownedCall(userId, callId);
    const signal = this.signalPayload(row, 'call.reject');
    void this.signaling.publish({ toUserId: row.callerId, fromUserId: userId, kind: 'call.reject', payload: signal });
    return this.view(row, userId);
  }

  async end(userId: string, callId: string, reason?: CallEndReason) {
    const current = await this.ownedCall(userId, callId);
    if (isTerminalCallStatus(current.status)) return this.view(current, userId);
    const now = new Date();
    let status: CallStatus;
    let endReason: string;
    let signalKind: CallSignalKind;
    if (current.status === CallStatus.ACCEPTED) {
      status = CallStatus.COMPLETED;
      endReason = reason ?? (current.callerId === userId ? 'caller_end' : 'callee_end');
      signalKind = 'call.end';
    } else if (current.callerId === userId) {
      status = CallStatus.CANCELLED;
      endReason = 'caller_cancel';
      signalKind = 'call.cancel';
    } else {
      status = CallStatus.REJECTED;
      endReason = 'callee_reject';
      signalKind = 'call.reject';
    }
    const result = await this.prisma.call.updateMany({
      where: { id: callId, status: current.status },
      data: {
        status,
        endedAt: now,
        endReason,
        durationSec: current.status === CallStatus.ACCEPTED ? callDurationSeconds(current.acceptedAt, now) : 0,
      },
    });
    const row = await this.ownedCall(userId, callId);
    if (result.count === 1) {
      const otherUserId = row.callerId === userId ? row.calleeId : row.callerId;
      void this.signaling.publish({ toUserId: otherUserId, fromUserId: userId, kind: signalKind, payload: this.signalPayload(row, signalKind) });
    }
    return this.view(row, userId);
  }

  async history(userId: string, query: CallHistoryQueryDto) {
    const participant: Prisma.CallWhereInput = query.direction === CallDirection.OUTGOING
      ? { callerId: userId }
      : query.direction === CallDirection.INCOMING
        ? { calleeId: userId }
        : { OR: [{ callerId: userId }, { calleeId: userId }] };
    const where: Prisma.CallWhereInput = {
      ...participant,
      ...(query.status ? { status: query.status } : {}),
      ...(query.call_type ? { callType: query.call_type } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.call.count({ where }),
      this.prisma.call.findMany({
        where,
        include: { caller: true, callee: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    const files = await this.avatarFiles(rows);
    return {
      data: rows.map((row) => this.viewWithFiles(row, userId, files)),
      extra: pageExtra(query.page, query.limit, total),
    };
  }

  async expireRingingCall(callId: string) {
    const now = new Date();
    const result = await this.prisma.call.updateMany({
      where: { id: callId, status: CallStatus.RINGING },
      data: { status: CallStatus.MISSED, endedAt: now, endReason: 'timeout' },
    });
    if (result.count !== 1) return { expired: false };
    const row = await this.prisma.call.findUniqueOrThrow({ where: { id: callId }, include: { caller: true, callee: true } });
    const payload = this.signalPayload(row, 'call.missed');
    void Promise.allSettled([
      this.signaling.publish({ toUserId: row.callerId, fromUserId: row.calleeId, kind: 'call.missed', payload }),
      this.signaling.publish({ toUserId: row.calleeId, fromUserId: row.callerId, kind: 'call.missed', payload }),
    ]);
    return { expired: true };
  }

  private async markExpiredRingingCalls() {
    const cutoff = new Date(Date.now() - RINGING_TIMEOUT_MS);
    await this.prisma.call.updateMany({
      where: { status: CallStatus.RINGING, ringingAt: { lte: cutoff } },
      data: { status: CallStatus.MISSED, endedAt: new Date(), endReason: 'timeout_recovery' },
    });
  }

  private async ownedCall(userId: string, callId: string) {
    const row = await this.prisma.call.findUnique({ where: { id: callId }, include: { caller: true, callee: true } });
    if (!row) throw new NotFoundException('Không tìm thấy cuộc gọi');
    if (row.callerId !== userId && row.calleeId !== userId) throw new ForbiddenException('Bạn không thuộc cuộc gọi này');
    return this.expireIfStale(row);
  }

  /**
   * Lưới an toàn cho job BullMQ `expire-ringing-call`.
   *
   * Đặt ở `ownedCall` chứ không ở riêng `get`, vì mọi đường đi vào MỘT cuộc
   * gọi cụ thể đều qua đây. Nhờ vậy cuộc gọi quá hạn không chỉ hiện đúng khi
   * đọc, mà còn không thể `accept` được nữa — trước đây người nhận vẫn bấm
   * nghe được cuộc gọi mà bên kia đã bỏ đi từ lâu.
   *
   * Ghi `timeout_recovery` chứ không ghi `timeout` như job: đọc `end_reason`
   * là biết ngay job đã chạy hay lưới phải đỡ thay. Trùng với nhãn mà
   * `markExpiredRingingCalls` vẫn dùng.
   *
   * Không bắn tín hiệu `call.missed` ở đây — `expireRingingCall` có bắn, còn
   * đường này thì bên hỏi đã nhận câu trả lời ngay trong phản hồi, và bên
   * kia nhận ở nhịp poll `incoming`/`active` của chính họ.
   */
  private async expireIfStale(row: CallWithUsers): Promise<CallWithUsers> {
    if (!isRingingExpired(row, new Date(), RINGING_TIMEOUT_MS)) return row;
    const endedAt = new Date();
    const result = await this.prisma.call.updateMany({
      where: { id: row.id, status: CallStatus.RINGING },
      data: { status: CallStatus.MISSED, endedAt, endReason: 'timeout_recovery' },
    });
    /* Thua cuộc đua với job hoặc với một request khác: đọc lại cho đúng sự
       thật thay vì đoán trạng thái đã ghi. */
    if (result.count !== 1) {
      return this.prisma.call.findUniqueOrThrow({ where: { id: row.id }, include: { caller: true, callee: true } });
    }
    return { ...row, status: CallStatus.MISSED, endedAt, endReason: 'timeout_recovery' };
  }

  private async view(row: CallWithUsers, viewerId: string) {
    const files = await this.avatarFiles([row]);
    return this.viewWithFiles(row, viewerId, files);
  }

  private async avatarFiles(rows: CallWithUsers[]) {
    const ids = [...new Set(rows.flatMap((row) => [row.caller.avatarFileId, row.callee.avatarFileId]).filter((id): id is string => Boolean(id)))];
    const files = ids.length ? await this.prisma.fileUpload.findMany({ where: { id: { in: ids } } }) : [];
    return new Map(files.map((file) => [file.id, file]));
  }

  private viewWithFiles(row: CallWithUsers, viewerId: string, files: Map<string, FileUpload>) {
    const outgoing = row.callerId === viewerId;
    const peer = outgoing ? row.callee : row.caller;
    const avatar = peer.avatarFileId ? files.get(peer.avatarFileId) : undefined;
    return {
      call_id: row.id,
      channel_name: row.channelName,
      conversation_id: row.conversationId,
      caller_user_id: row.callerId,
      callee_user_id: row.calleeId,
      call_type: row.callType,
      status: row.status,
      status_label: callStatusLabels[row.status],
      direction: outgoing ? CallDirection.OUTGOING : CallDirection.INCOMING,
      peer: {
        user_id: peer.id,
        full_name: peer.fullName,
        avatar_url: avatar ? this.files.view(avatar).public_url : null,
      },
      end_reason: row.endReason,
      ringing_at: row.ringingAt.toISOString(),
      accepted_at: row.acceptedAt?.toISOString() ?? null,
      ended_at: row.endedAt?.toISOString() ?? null,
      duration_sec: row.durationSec,
      created_at: row.createdAt.toISOString(),
    };
  }

  private signalPayload(row: Call, kind: CallSignalKind) {
    return {
      call_id: row.id,
      channel_name: row.channelName,
      conversation_id: row.conversationId,
      call_type: row.callType,
      status: row.status,
      caller_user_id: row.callerId,
      callee_user_id: row.calleeId,
      event: kind,
    };
  }
}
