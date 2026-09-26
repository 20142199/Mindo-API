import { BadRequestException, HttpException, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ChatMessageType, UserRole, UserStatus } from '@prisma/client';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server as HttpServer } from 'node:http';
import { Namespace, Server, Socket } from 'socket.io';
import { PrismaService } from '../common/prisma.module';
import { PushNotificationService } from '../notification/push-notification.service';
import { parseSocketMessage } from './chat.domain';
import { ChatPresenceService } from './chat-presence.service';
import { ChatService } from './chat.service';

type ChatSocketData = { userId: string; role: UserRole };
type Ack = (payload: Record<string, unknown>) => void;

@Injectable()
export class ChatRealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger(ChatRealtimeService.name);
  private io?: Server;
  private namespace?: Namespace;
  private redisClients: Redis[] = [];

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
    private readonly presence: ChatPresenceService,
    private readonly push: PushNotificationService,
  ) {}

  async initialize(httpServer: HttpServer, origins: string[]) {
    if (this.io) return;
    this.io = new Server(httpServer, {
      cors: { origin: origins, credentials: true },
      transports: ['websocket', 'polling'],
    });
    await this.configureRedisAdapter();
    const namespace = this.io.of('/chat');
    this.namespace = namespace;
    namespace.use(async (socket, next) => {
      try {
        const tokenValue = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
        const raw = typeof tokenValue === 'string' ? tokenValue.trim() : '';
        const token = raw.startsWith('Bearer ') ? raw.slice(7).trim() : raw;
        if (!token) throw new Error('Thiếu access token');
        const identity = await this.jwt.verifyAsync<{ id: string; role: UserRole }>(token, {
          secret: process.env.JWT_ACCESS_SECRET,
        });
        const user = await this.prisma.user.findFirst({
          where: { id: identity.id, status: UserStatus.ACTIVE },
          select: { id: true, role: true },
        });
        if (!user) throw new Error('Tài khoản không khả dụng');
        (socket.data as ChatSocketData).userId = user.id;
        (socket.data as ChatSocketData).role = user.role;
        next();
      } catch (error) {
        next(new Error(`UNAUTHORIZED: ${error instanceof Error ? error.message : 'Token không hợp lệ'}`));
      }
    });
    namespace.on('connection', (socket) => this.bindSocket(socket));
    this.logger.log('Socket.IO messaging đã sẵn sàng tại namespace /chat');
  }

  async publishNewMessage(conversationId: string, message: Record<string, unknown>) {
    this.emitMessage('message:new', conversationId, message);
    await this.publishConversation(conversationId);
    void this.pushNewMessage(conversationId, message).catch((error) => {
      this.logger.warn(`Không gửi được push cho tin nhắn: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  /**
   * Bắn tin hệ thống vào phòng hội thoại.
   *
   * Tách khỏi `publishNewMessage` vì hai chỗ khác nhau ở hai điểm:
   *   - không gửi push: "… đã thêm 3 thành viên" không đáng làm rung máy;
   *   - không gọi `publishConversation`: ba đường sinh ra tin hệ thống đều
   *     đã gọi nó ngay trước đó rồi, gọi lại là fan-out hai lần cho mỗi
   *     thành viên.
   */
  publishSystemMessage(conversationId: string, message: Record<string, unknown>) {
    this.emitMessage('message:new', conversationId, message);
  }

  /**
   * Bắn một tin vào phòng hội thoại, GỠ `is_own` ra trước.
   *
   * `is_own` là một khẳng định TƯƠNG ĐỐI với người hỏi: nó trả lời câu "tin
   * này có phải của bạn không". Trên phản hồi REST thì đúng, vì có đúng một
   * người hỏi. Trên một bản tin phát sóng thì KHÔNG CÓ "bạn" nào cả — payload
   * được dựng theo góc nhìn người GỬI, nên gửi nguyên si là mọi người trong
   * phòng đều nhận `is_own: true`, và tin của người khác hiện ra bên phải màn
   * hình như thể chính họ vừa gõ.
   *
   * Không dựng lại payload cho từng người như `publishConversation`: nội dung
   * tin giống hệt nhau với mọi người, chỉ mỗi trường này là tương đối. Gỡ nó
   * ra rẻ hơn nhiều lần đọc CSDL, và buộc client tự so `sender.user_id` —
   * việc mà chỉ client mới làm đúng được.
   */
  private emitMessage(
    event: 'message:new' | 'message:updated',
    conversationId: string,
    message: Record<string, unknown>,
  ) {
    const { is_own: _ignored, ...shared } = message;
    this.namespace?.to(this.channelRoom(conversationId)).emit(event, { message: shared });
  }

  publishMessageUpdated(conversationId: string, message: Record<string, unknown>) {
    this.emitMessage('message:updated', conversationId, message);
    void this.publishConversation(conversationId);
  }

  publishMessageDeleted(conversationId: string, data: Record<string, unknown>) {
    this.namespace?.to(this.channelRoom(conversationId)).emit('message:deleted', data);
    void this.publishConversation(conversationId);
  }

  publishRead(conversationId: string, userId: string, data: Record<string, unknown>) {
    this.namespace?.to(this.channelRoom(conversationId)).emit('message:read', { user_id: userId, ...data });
    void this.publishConversation(conversationId);
  }

  /**
   * Bắn hội thoại đã cập nhật về cho TẤT CẢ thành viên.
   *
   * Mỗi người nhận một payload riêng vì bốn trường phụ thuộc người xem: số
   * tin chưa đọc, `is_muted`, `is_own` của tin cuối, và với hội thoại 1-1 là
   * tên/ảnh của "người kia".
   *
   * Nhưng phần còn lại thì giống hệt nhau, nên đọc CSDL MỘT lần rồi dựng N
   * payload — xem `getConversationItemsForMembers`. Bản đầu gọi
   * `getConversationItemForUser` cho từng người, tức năm truy vấn nhân N:
   * nhóm 99 người là gần 500 truy vấn cho một tin nhắn.
   */
  async publishConversation(conversationId: string) {
    if (!this.namespace) return;
    const userIds = await this.chat.getMemberUserIds(conversationId);
    const items = await this.chat.getConversationItemsForMembers(conversationId, userIds);
    for (const [userId, item] of items) {
      this.namespace.to(this.userRoom(userId)).emit('conversation:updated', { item });
    }
  }

  async publishGroupDeleted(conversationId: string, data: Record<string, unknown>) {
    const userIds = await this.chat.getMemberUserIds(conversationId);
    this.namespace?.to(this.channelRoom(conversationId)).emit('conversation:deleted', data);
    userIds.forEach((userId) => this.namespace?.to(this.userRoom(userId)).emit('conversation:deleted', data));
  }

  publishConversationRemoved(userId: string, conversationId: string, reason: 'removed' | 'left' | 'hidden') {
    this.namespace?.to(this.userRoom(userId)).emit('conversation:removed', {
      conversation_id: conversationId,
      reason,
    });
  }

  async onModuleDestroy() {
    await this.io?.close();
    await Promise.all(this.redisClients.map((client) => client.quit().catch(() => undefined)));
  }

  private bindSocket(socket: Socket) {
    const { userId } = socket.data as ChatSocketData;
    void socket.join(this.userRoom(userId));
    void this.presence.connect(userId, socket.id);

    socket.on('channel:join', async (payload: unknown, ack?: Ack) => {
      await this.handle(socket, 'channel:join', ack, async () => {
        const conversationId = this.conversationId(payload);
        await this.chat.assertMembership(userId, conversationId);
        await socket.join(this.channelRoom(conversationId));
        return { channelId: conversationId };
      });
    });

    socket.on('channel:leave', async (payload: unknown, ack?: Ack) => {
      await this.handle(socket, 'channel:leave', ack, async () => {
        const conversationId = this.conversationId(payload);
        await socket.leave(this.channelRoom(conversationId));
        return { channelId: conversationId };
      });
    });

    socket.on('message:send', async (payload: unknown, ack?: Ack) => {
      await this.handle(socket, 'message:send', ack, async () => {
        const dto = parseSocketMessage(payload);
        const result = await this.chat.sendMessage(userId, dto.channelId, {
          message_type: dto.messageType ?? ChatMessageType.TEXT,
          content: dto.content,
          attachments: dto.attachments?.map((item) => ({ file_id: item.fileId })),
          client_message_id: dto.clientMessageId,
          reply_to_message_id: dto.replyToMessageId,
        });
        if (!result.duplicate) await this.publishNewMessage(dto.channelId, result.message);
        return {
          clientMessageId: dto.clientMessageId,
          messageId: result.message.message_id,
          status: result.duplicate ? 'duplicate' : 'persisted',
          createdAt: result.message.created_at,
        };
      });
    });

    socket.on('message:edit', async (payload: unknown, ack?: Ack) => {
      await this.handle(socket, 'message:edit', ack, async () => {
        const value = this.record(payload);
        const messageId = this.requiredString(value.messageId, 'messageId');
        const content = this.requiredString(value.content, 'content');
        const message = await this.chat.editMessage(userId, messageId, { content });
        this.publishMessageUpdated(message.conversation_id, message);
        return { messageId, editedAt: message.edited_at };
      });
    });

    socket.on('message:delete', async (payload: unknown, ack?: Ack) => {
      await this.handle(socket, 'message:delete', ack, async () => {
        const value = this.record(payload);
        const messageId = this.requiredString(value.messageId, 'messageId');
        const deleted = await this.chat.deleteMessage(userId, messageId);
        this.publishMessageDeleted(deleted.conversation_id, deleted);
        return { messageId, deletedAt: deleted.deleted_at };
      });
    });

    /*
     * Báo "đang soạn tin" phải tới được CẢ người không mở hội thoại.
     *
     * Bản đầu chỉ bắn vào `channel:<id>`, mà người ta chỉ vào phòng đó khi
     * MỞ hội thoại. Nên đứng ở màn danh sách thì không bao giờ nhận được —
     * dù client đã sẵn sàng hiện "Đang soạn tin…" ngay trên dòng xem trước.
     *
     * Nay bắn thêm vào phòng riêng của từng thành viên khác. Phòng
     * `user:<id>` được vào lúc kết nối nên luôn tới, kể cả khi họ đang đứng
     * ở tab khác.
     *
     * Hai phòng có thể trùng nhau ở người đang mở hội thoại, nhưng
     * Socket.IO khử trùng theo socket khi phát tới nhiều phòng trong MỘT lời
     * gọi, nên gộp cả hai vào một `.to()` thay vì gọi hai lần.
     */
    for (const event of ['typing:start', 'typing:stop'] as const) {
      socket.on(event, async (payload: unknown, ack?: Ack) => {
        await this.handle(socket, event, ack, async () => {
          const conversationId = this.conversationId(payload);
          await this.chat.assertMembership(userId, conversationId);

          const memberIds = await this.chat.getMemberUserIds(conversationId);
          const rooms = [
            this.channelRoom(conversationId),
            ...memberIds.filter((id) => id !== userId).map((id) => this.userRoom(id)),
          ];

          socket.to(rooms).emit('typing:peer', {
            channelId: conversationId,
            userId,
            isTyping: event === 'typing:start',
          });
          return { channelId: conversationId, isTyping: event === 'typing:start' };
        });
      });
    }

    socket.on('disconnect', () => {
      void this.presence.disconnect(userId, socket.id);
    });
  }

  private async configureRedisAdapter() {
    if (!this.io) return;
    const options = {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      lazyConnect: true,
      maxRetriesPerRequest: null,
      connectTimeout: 2_000,
      retryStrategy: () => null,
    };
    const pub = new Redis(options);
    const sub = new Redis(options);
    try {
      await Promise.all([pub.connect(), sub.connect()]);
      this.io.adapter(createAdapter(pub, sub));
      this.redisClients = [pub, sub];
    } catch (error) {
      pub.disconnect();
      sub.disconnect();
      this.logger.warn(`Không bật được Redis adapter, Socket.IO chạy một node: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async pushNewMessage(conversationId: string, message: Record<string, unknown>) {
    const sender = message.sender && typeof message.sender === 'object'
      ? message.sender as Record<string, unknown>
      : undefined;
    const senderUserId = typeof sender?.user_id === 'string' ? sender.user_id : '';
    const messageId = typeof message.message_id === 'string' ? message.message_id : '';
    if (!senderUserId || !messageId) return;
    const context = await this.chat.getPushContext(conversationId, senderUserId);
    if (!context?.recipientUserIds.length) return;
    await this.push.notifyChatMessage(context.recipientUserIds, {
      conversationId,
      messageId,
      senderUserId,
      senderName: context.senderName,
      conversationTitle: context.conversationTitle,
      messageType: typeof message.message_type === 'string' ? message.message_type : 'text',
      content: typeof message.content === 'string' ? message.content : null,
    });
  }

  private async handle(
    socket: Socket,
    event: string,
    ack: Ack | undefined,
    work: () => Promise<Record<string, unknown>>,
  ) {
    try {
      const data = await work();
      ack?.({ ok: true, ...data });
    } catch (error) {
      const isExpected = error instanceof HttpException;
      const response = {
        ok: false,
        code: this.errorCode(error),
        message: isExpected ? error.message : 'Không xử lý được yêu cầu',
        event,
      };
      if (!isExpected) this.logger.error(`Socket event ${event} thất bại`, error instanceof Error ? error.stack : String(error));
      socket.emit('error', response);
      ack?.(response);
    }
  }

  private conversationId(payload: unknown) {
    return this.requiredString(this.record(payload).channelId, 'channelId');
  }

  private record(payload: unknown) {
    if (!payload || typeof payload !== 'object') throw new BadRequestException('Payload không hợp lệ');
    return payload as Record<string, unknown>;
  }

  private requiredString(value: unknown, field: string) {
    if (typeof value !== 'string' || !value.trim() || value.length > 10_000) throw new BadRequestException(`${field} không hợp lệ`);
    return value.trim();
  }

  private errorCode(error: unknown) {
    const name = error instanceof Error ? error.constructor.name : '';
    if (name.includes('Forbidden')) return 'FORBIDDEN';
    if (name.includes('NotFound')) return 'NOT_FOUND';
    if (name.includes('Conflict')) return 'CONFLICT';
    return 'VALIDATION_FAILED';
  }

  private channelRoom(id: string) { return `channel:${id}`; }
  private userRoom(id: string) { return `user:${id}`; }
}
