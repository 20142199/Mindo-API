import { BadRequestException, HttpException, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ChatMessageType, UserRole, UserStatus } from '@prisma/client';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server as HttpServer } from 'node:http';
import { Namespace, Server, Socket } from 'socket.io';
import { PrismaService } from '../common/prisma.module';
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
    this.namespace?.to(this.channelRoom(conversationId)).emit('message:new', { message });
    await this.publishConversation(conversationId);
  }

  publishMessageUpdated(conversationId: string, message: Record<string, unknown>) {
    this.namespace?.to(this.channelRoom(conversationId)).emit('message:updated', { message });
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

  async publishConversation(conversationId: string) {
    if (!this.namespace) return;
    const userIds = await this.chat.getMemberUserIds(conversationId);
    await Promise.all(userIds.map(async (userId) => {
      try {
        const item = await this.chat.getConversationItemForUser(userId, conversationId);
        this.namespace?.to(this.userRoom(userId)).emit('conversation:updated', { item });
      } catch {
        // Thành viên vừa rời nhóm hoặc nhóm vừa bị xóa: không còn item để dựng.
      }
    }));
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
          reply_to_message_id: dto.parentMessageId,
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

    for (const event of ['typing:start', 'typing:stop'] as const) {
      socket.on(event, async (payload: unknown, ack?: Ack) => {
        await this.handle(socket, event, ack, async () => {
          const conversationId = this.conversationId(payload);
          await this.chat.assertMembership(userId, conversationId);
          socket.to(this.channelRoom(conversationId)).emit('typing:peer', {
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
