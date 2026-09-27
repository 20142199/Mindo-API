import { Injectable, Logger } from '@nestjs/common';
import {
  Call,
  CallStatus,
  CallType,
  ChatMessageType,
  ConversationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../common/prisma.module';
import { ChatRealtimeService } from '../chat/chat-realtime.service';
import { directConversationKey } from '../chat/chat.domain';

/**
 * Ghi mỗi cuộc gọi đã kết thúc thành một tin trong hội thoại — như Messenger.
 *
 * Vì sao cần: người ta nhớ "hôm qua gọi nhau xong thì nhắn gì". Cuộc gọi chỉ
 * nằm ở màn Lịch sử cuộc gọi thì dòng thời gian trong chat bị đứt mạch, và
 * muốn biết đã gọi lúc nào phải thoát ra màn khác tra lại.
 *
 * Tin thuộc loại HỆ THỐNG, không có người gửi: nó là chuyện xảy ra giữa hai
 * người chứ không phải lời ai nói. `content` mang sẵn câu chữ nên bản app cũ
 * đọc được ngay; `callInfo` mang số liệu để bản mới vẽ icon và tô đỏ cuộc nhỡ.
 *
 * TỰ TẠO HỘI THOẠI nếu hai người chưa từng nhắn. Gọi cho ai đó rồi mở Tin
 * nhắn không thấy gì là mất dấu cuộc gọi — Messenger cũng tạo.
 */
@Injectable()
export class CallChatLogService {
  private readonly logger = new Logger(CallChatLogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: ChatRealtimeService,
  ) {}

  /**
   * KHÔNG BAO GIỜ NÉM và không bao giờ chặn luồng gọi.
   *
   * Nhật ký hỏng thì mất một dòng trong chat; ném ra đây thì người dùng KHÔNG
   * cúp máy được, vì `end()` sẽ đổ ngay sau khi đã ghi trạng thái vào CSDL.
   * Mọi chỗ gọi đều dùng `void this.chatLog.record(...)`.
   */
  async record(call: Call): Promise<void> {
    try {
      const conversationId = await this.directConversation(call.callerId, call.calleeId);
      const info = this.callInfo(call);

      const row = await this.prisma.chatMessage.create({
        data: {
          conversationId,
          type: ChatMessageType.SYSTEM,
          content: this.describe(call),
          callInfo: info as unknown as Prisma.InputJsonObject,
        },
      });
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: row.createdAt },
      });

      /* Hai lần đẩy, và cần CẢ HAI — chúng tới hai chỗ khác nhau:
           `publishSystemMessageById` bắn `message:new` vào PHÒNG HỘI THOẠI,
              cho màn chat đang mở;
           `publishConversation` bắn `conversation:updated` vào phòng riêng
              của từng người, cho DANH SÁCH tin nhắn.

         Thiếu cái đầu thì dòng nhật ký không hiện cho tới khi người dùng
         thoát ra rồi vào lại — đúng thứ đo được trên iPhone 14 Pro Max ngày
         27/09/2026: cúp máy, bấm "Đóng", về hội thoại mà không thấy gì, trong
         khi danh sách ngoài đã đổi. */
      await this.realtime.publishSystemMessageById(conversationId, row.id, call.callerId);
      await this.realtime.publishConversation(conversationId);
    } catch (error) {
      this.logger.warn(
        `Không ghi được nhật ký cuộc gọi ${call.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Id hội thoại 1-1 giữa hai người, tạo mới nếu chưa có.
   *
   * `directKey` là khoá duy nhất băm từ hai id đã sắp xếp, nên `upsert` ở đây
   * an toàn với hai cuộc gọi kết thúc cùng lúc: cái thứ hai rơi vào nhánh
   * `update` rỗng thay vì tạo ra hội thoại thứ hai.
   */
  private async directConversation(callerId: string, calleeId: string) {
    const directKey = directConversationKey(callerId, calleeId);
    const existing = await this.prisma.conversation.findUnique({
      where: { directKey },
      select: { id: true },
    });
    if (existing) return existing.id;

    const created = await this.prisma.conversation.create({
      data: {
        type: ConversationType.DIRECT,
        directKey,
        createdById: callerId,
        members: {
          create: [{ userId: callerId }, { userId: calleeId }],
        },
      },
      select: { id: true },
    });
    return created.id;
  }

  private callInfo(call: Call) {
    return {
      call_id: call.id,
      call_type: call.callType,
      status: call.status,
      duration_sec: call.durationSec ?? 0,
      caller_user_id: call.callerId,
    };
  }

  /**
   * Câu chữ cho bản app chưa biết `callInfo`.
   *
   * Không ghi "ai gọi ai": tin hệ thống hiện giống nhau cho cả hai phía, mà
   * "Bạn đã gọi" thì đúng với một người và sai với người kia. App mới tự suy
   * từ `caller_user_id`.
   */
  private describe(call: Call) {
    const kind = call.callType === CallType.VIDEO ? 'Cuộc gọi video' : 'Cuộc gọi thoại';
    if (call.status === CallStatus.COMPLETED) {
      return `${kind} · ${this.duration(call.durationSec ?? 0)}`;
    }
    if (call.status === CallStatus.MISSED) return `${kind} nhỡ`;
    if (call.status === CallStatus.REJECTED) return `${kind} bị từ chối`;
    if (call.status === CallStatus.CANCELLED) return `${kind} đã huỷ`;
    return kind;
  }

  private duration(seconds: number) {
    if (seconds < 60) return `${seconds} giây`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest ? `${minutes} phút ${rest} giây` : `${minutes} phút`;
  }
}
