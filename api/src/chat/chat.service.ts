import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChatMessageType,
  ConversationMemberRole,
  ConversationType,
  FileUpload,
  Prisma,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { pageExtra } from '../common/api-response';
import { PrismaService } from '../common/prisma.module';
import { FileStorageService } from '../phase1/file-storage.service';
import {
  AddGroupMembersDto,
  ChatMessageQueryDto,
  ChatPageQueryDto,
  CreateChatMessageDto,
  CreateGroupConversationDto,
  EditChatMessageDto,
  UpdateGroupConversationDto,
} from './chat.dto';
import { ChatPresenceService } from './chat-presence.service';
import { directConversationKey, messagePreview } from './chat.domain';

type BasicUser = Pick<User, 'id' | 'fullName' | 'nickname' | 'email' | 'phone' | 'avatarFileId'>;

const memberUserSelect = {
  id: true,
  fullName: true,
  nickname: true,
  email: true,
  phone: true,
  avatarFileId: true,
} satisfies Prisma.UserSelect;

const conversationInclude = {
  members: {
    where: { leftAt: null },
    include: { user: { select: memberUserSelect } },
    orderBy: { joinedAt: 'asc' },
  },
  messages: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    include: { sender: { select: memberUserSelect } },
  },
} satisfies Prisma.ConversationInclude;

type ConversationRow = Prisma.ConversationGetPayload<{ include: typeof conversationInclude }>;
type MessageRow = Prisma.ChatMessageGetPayload<{ include: { sender: { select: typeof memberUserSelect } } }>;

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileStorageService,
    private readonly presence: ChatPresenceService,
  ) {}

  async startDirect(userId: string, peerUserId: string) {
    if (userId === peerUserId) throw new BadRequestException('Không thể tự nhắn tin với chính mình');
    await this.assertFriend(userId, peerUserId);
    const directKey = directConversationKey(userId, peerUserId);
    const conversation = await this.prisma.$transaction(async (tx) => {
      const row = await tx.conversation.upsert({
        where: { directKey },
        update: { deletedAt: null },
        create: {
          type: ConversationType.DIRECT,
          directKey,
          createdById: userId,
          members: {
            create: [
              { userId, role: ConversationMemberRole.OWNER },
              { userId: peerUserId, role: ConversationMemberRole.MEMBER },
            ],
          },
        },
      });
      await tx.conversationMember.updateMany({
        where: { conversationId: row.id, userId },
        data: { isHidden: false, leftAt: null },
      });
      return row;
    });
    return this.getConversation(userId, conversation.id);
  }

  async createGroup(userId: string, dto: CreateGroupConversationDto) {
    const memberIds = [...new Set(dto.member_user_ids)].filter((id) => id !== userId);
    if (!memberIds.length) throw new BadRequestException('Nhóm cần ít nhất một thành viên khác');
    await this.assertFriends(userId, memberIds);
    if (dto.avatar_file_id) {
      const avatar = await this.files.assertOwned(userId, dto.avatar_file_id);
      if (!avatar.mimeType.startsWith('image/')) throw new BadRequestException('Ảnh nhóm phải là tệp hình ảnh');
    }
    const conversation = await this.prisma.conversation.create({
      data: {
        type: ConversationType.GROUP,
        title: dto.title,
        avatarFileId: dto.avatar_file_id,
        createdById: userId,
        members: {
          create: [
            { userId, role: ConversationMemberRole.OWNER },
            ...memberIds.map((memberId) => ({ userId: memberId, role: ConversationMemberRole.MEMBER })),
          ],
        },
      },
    });
    const systemMessage = await this.createSystemMessage(userId, conversation.id, `${await this.userName(userId)} đã tạo nhóm`);
    return { ...(await this.getConversation(userId, conversation.id)), system_message: systemMessage };
  }

  async listConversations(userId: string, query: ChatPageQueryDto) {
    const q = query.q?.trim();
    const where: Prisma.ConversationWhereInput = {
      deletedAt: null,
      members: { some: { userId, leftAt: null, isHidden: false } },
      ...(q ? {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { members: { some: { leftAt: null, user: { OR: [
            { fullName: { contains: q, mode: 'insensitive' } },
            { nickname: { contains: q, mode: 'insensitive' } },
          ] } } } },
          { messages: { some: { deletedAt: null, content: { contains: q, mode: 'insensitive' } } } },
        ],
      } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.conversation.count({ where }),
      this.prisma.conversation.findMany({
        where,
        include: conversationInclude,
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    const data = await this.serializeConversationRows(userId, rows);
    return { data, extra: pageExtra(query.page, query.limit, total) };
  }

  async getConversation(userId: string, conversationId: string) {
    await this.assertMembership(userId, conversationId);
    const row = await this.prisma.conversation.findFirst({
      where: { id: conversationId, deletedAt: null },
      include: conversationInclude,
    });
    if (!row) throw new NotFoundException('Không tìm thấy hội thoại');
    return (await this.serializeConversationRows(userId, [row], true))[0];
  }

  async listMessages(userId: string, conversationId: string, query: ChatMessageQueryDto) {
    const member = await this.assertMembership(userId, conversationId);
    const cursor = query.cursor
      ? await this.prisma.chatMessage.findFirst({ where: { id: query.cursor, conversationId }, select: { id: true, createdAt: true } })
      : null;
    if (query.cursor && !cursor) throw new BadRequestException('Cursor tin nhắn không hợp lệ');
    const rows = await this.prisma.chatMessage.findMany({
      where: {
        conversationId,
        AND: [
          { createdAt: { gte: member.joinedAt } },
          ...(cursor ? [{ OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ] }] : []),
        ],
        ...(query.q ? { deletedAt: null, content: { contains: query.q, mode: 'insensitive' } } : {}),
      },
      include: { sender: { select: memberUserSelect } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    return {
      items: (await this.serializeMessages(userId, page)).reverse(),
      has_more: hasMore,
      next_cursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    };
  }

  async sendMessage(userId: string, conversationId: string, dto: CreateChatMessageDto) {
    await this.assertMembership(userId, conversationId);
    this.validateMessageBody(dto);
    const attachmentRows = await this.attachmentRows(userId, dto.attachments?.map((item) => item.file_id) ?? []);
    if (dto.message_type === ChatMessageType.IMAGE && attachmentRows.some((file) => !file.mimeType.startsWith('image/'))) {
      throw new BadRequestException('Tin nhắn ảnh chỉ nhận tệp hình ảnh');
    }
    const quoted = dto.reply_to_message_id
      ? await this.buildQuotedSnapshot(conversationId, dto.reply_to_message_id)
      : null;
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const message = await tx.chatMessage.create({
          data: {
            conversationId,
            senderId: userId,
            type: dto.message_type,
            content: dto.content?.trim() || null,
            clientMessageId: dto.client_message_id,
            replyToId: dto.reply_to_message_id,
            quotedMessageSnapshot: quoted ?? undefined,
            attachments: attachmentRows.length ? this.attachmentSnapshots(attachmentRows) : undefined,
          },
          include: { sender: { select: memberUserSelect } },
        });
        await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: message.createdAt } });
        await tx.conversationMember.updateMany({
          where: { conversationId, leftAt: null },
          data: { isHidden: false },
        });
        await tx.conversationMember.update({
          where: { conversationId_userId: { conversationId, userId } },
          data: { lastReadMessageId: message.id, lastReadAt: message.createdAt },
        });
        return message;
      });
      return { message: await this.serializeMessage(userId, row), duplicate: false };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.chatMessage.findFirst({
          where: { conversationId, clientMessageId: dto.client_message_id, senderId: userId },
          include: { sender: { select: memberUserSelect } },
        });
        if (existing) return { message: await this.serializeMessage(userId, existing), duplicate: true };
      }
      throw error;
    }
  }

  async editMessage(userId: string, messageId: string, dto: EditChatMessageDto) {
    const row = await this.ownedMessage(userId, messageId);
    if (row.deletedAt) throw new ConflictException('Tin nhắn đã bị thu hồi');
    /*
      Chỉ tin CHỮ mới sửa được.
      Endpoint này chỉ ghi đè cột `content`, không đụng gì tới `attachments`.
      Với tin ảnh hay tệp thì nó nhận rồi lưu một đoạn chữ vào cạnh tệp vẫn
      nguyên đó — client không vẽ đoạn chữ ấy ở đâu cả (bong bóng ảnh chỉ vẽ
      ảnh), nhưng dòng xem trước ở danh sách hội thoại thì có. Kết quả là một
      tin ảnh mang dòng xem trước bịa ra, và không cách nào gỡ.
      Trả 400 thẳng, còn hơn nhận một thay đổi rồi giấu nó đi.
    */
    if (row.type !== ChatMessageType.TEXT) {
      throw new BadRequestException('Chỉ sửa được tin nhắn dạng chữ');
    }
    if (Date.now() - row.createdAt.getTime() > 72 * 60 * 60 * 1000) {
      throw new ForbiddenException('Chỉ được sửa tin nhắn trong vòng 72 giờ');
    }
    const updated = await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: { content: dto.content, editedAt: new Date() },
      include: { sender: { select: memberUserSelect } },
    });
    return this.serializeMessage(userId, updated);
  }

  async deleteMessage(userId: string, messageId: string) {
    const row = await this.ownedMessage(userId, messageId);
    if (row.deletedAt) return { message_id: row.id, conversation_id: row.conversationId, deleted_at: row.deletedAt.toISOString() };
    const deletedAt = new Date();
    await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: { deletedAt, content: null, attachments: Prisma.JsonNull },
    });
    return { message_id: row.id, conversation_id: row.conversationId, deleted_at: deletedAt.toISOString() };
  }

  async saveMessage(userId: string, messageId: string, saved: boolean) {
    const message = await this.prisma.chatMessage.findUnique({ where: { id: messageId } });
    if (!message || message.deletedAt) throw new NotFoundException('Không tìm thấy tin nhắn');
    await this.assertMembership(userId, message.conversationId);
    if (saved) {
      await this.prisma.savedChatMessage.upsert({
        where: { userId_messageId: { userId, messageId } },
        update: {},
        create: { userId, messageId },
      });
    } else {
      await this.prisma.savedChatMessage.deleteMany({ where: { userId, messageId } });
    }
    return { message_id: messageId, saved };
  }

  async listSavedMessages(userId: string, query: ChatPageQueryDto) {
    const where: Prisma.SavedChatMessageWhereInput = {
      userId,
      message: {
        deletedAt: null,
        ...(query.q ? { content: { contains: query.q, mode: 'insensitive' } } : {}),
      },
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.savedChatMessage.count({ where }),
      this.prisma.savedChatMessage.findMany({
        where,
        include: { message: { include: { sender: { select: memberUserSelect } } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return {
      data: await this.serializeMessages(userId, rows.map((row) => row.message)),
      extra: pageExtra(query.page, query.limit, total),
    };
  }

  async markRead(userId: string, conversationId: string, messageId?: string) {
    await this.assertMembership(userId, conversationId);
    const last = messageId
      ? await this.prisma.chatMessage.findFirst({ where: { id: messageId, conversationId } })
      : await this.prisma.chatMessage.findFirst({ where: { conversationId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    if (messageId && !last) throw new BadRequestException('Tin nhắn không thuộc hội thoại');
    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadMessageId: last?.id ?? null, lastReadAt: last?.createdAt ?? new Date() },
    });
    return { conversation_id: conversationId, last_read_message_id: last?.id ?? null, read_at: new Date().toISOString() };
  }

  async setMuted(userId: string, conversationId: string, isMuted: boolean) {
    await this.assertMembership(userId, conversationId);
    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { isMuted },
    });
    return { conversation_id: conversationId, is_muted: isMuted };
  }

  async hideConversation(userId: string, conversationId: string) {
    await this.assertMembership(userId, conversationId);
    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { isHidden: true },
    });
    return { conversation_id: conversationId, hidden: true };
  }

  async updateGroup(userId: string, conversationId: string, dto: UpdateGroupConversationDto) {
    await this.assertManager(userId, conversationId);
    if (!dto.title && !dto.avatar_file_id) throw new BadRequestException('Không có thông tin nhóm cần cập nhật');
    if (dto.avatar_file_id) {
      const avatar = await this.files.assertOwned(userId, dto.avatar_file_id);
      if (!avatar.mimeType.startsWith('image/')) throw new BadRequestException('Ảnh nhóm phải là tệp hình ảnh');
    }
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { ...(dto.title ? { title: dto.title } : {}), ...(dto.avatar_file_id ? { avatarFileId: dto.avatar_file_id } : {}) },
    });
    return this.getConversation(userId, conversationId);
  }

  async addMembers(userId: string, conversationId: string, dto: AddGroupMembersDto) {
    await this.assertManager(userId, conversationId);
    const ids = [...new Set(dto.member_user_ids)].filter((id) => id !== userId);
    await this.assertFriends(userId, ids);
    await this.prisma.conversationMember.createMany({
      data: ids.map((memberId) => ({ conversationId, userId: memberId })),
      skipDuplicates: true,
    });
    await this.prisma.conversationMember.updateMany({
      where: { conversationId, userId: { in: ids } },
      data: { leftAt: null, isHidden: false },
    });
    const systemMessage = await this.createSystemMessage(userId, conversationId, `${await this.userName(userId)} đã thêm ${ids.length} thành viên`);
    return { ...(await this.getConversation(userId, conversationId)), system_message: systemMessage };
  }

  async removeMember(userId: string, conversationId: string, memberUserId: string) {
    const actor = await this.assertManager(userId, conversationId);
    if (memberUserId === userId) return this.leaveGroup(userId, conversationId);
    const target = await this.assertMembership(memberUserId, conversationId);
    if (target.role === ConversationMemberRole.OWNER) throw new ForbiddenException('Không thể xóa chủ nhóm');
    if (actor.role !== ConversationMemberRole.OWNER && target.role === ConversationMemberRole.ADMIN) {
      throw new ForbiddenException('Quản trị viên không thể xóa quản trị viên khác');
    }
    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId: memberUserId } },
      data: { leftAt: new Date(), isHidden: true },
    });
    const systemMessage = await this.createSystemMessage(userId, conversationId, `${await this.userName(memberUserId)} đã được đưa ra khỏi nhóm`);
    return { conversation_id: conversationId, removed_user_id: memberUserId, system_message: systemMessage };
  }

  async leaveGroup(userId: string, conversationId: string) {
    const member = await this.assertMembership(userId, conversationId);
    const group = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!group || group.type !== ConversationType.GROUP) throw new BadRequestException('Đây không phải hội thoại nhóm');
    let dissolved = false;
    await this.prisma.$transaction(async (tx) => {
      if (member.role === ConversationMemberRole.OWNER) {
        const successor = await tx.conversationMember.findFirst({
          where: { conversationId, userId: { not: userId }, leftAt: null },
          orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
        });
        if (successor) {
          await tx.conversationMember.update({
            where: { conversationId_userId: { conversationId, userId: successor.userId } },
            data: { role: ConversationMemberRole.OWNER },
          });
        } else {
          await tx.conversation.update({ where: { id: conversationId }, data: { deletedAt: new Date() } });
          dissolved = true;
        }
      }
      await tx.conversationMember.update({
        where: { conversationId_userId: { conversationId, userId } },
        data: { leftAt: new Date(), isHidden: true },
      });
    });
    /* Người ở lại phải thấy có người đã đi, y như khi bị đưa ra khỏi nhóm.
       Trừ lúc nhóm vừa tan — chủ nhóm rời đi mà không còn ai kế nhiệm: viết
       tiếp vào một hội thoại đã xóa thì không ai đọc, mà `lastMessageAt` lại
       bị đẩy lên. */
    const systemMessage = dissolved
      ? undefined
      : await this.createSystemMessage(userId, conversationId, `${await this.userName(userId)} đã rời nhóm`);
    return { conversation_id: conversationId, left: true, system_message: systemMessage };
  }

  async deleteGroup(userId: string, conversationId: string) {
    const member = await this.assertMembership(userId, conversationId);
    const group = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!group || group.type !== ConversationType.GROUP) throw new BadRequestException('Đây không phải hội thoại nhóm');
    if (member.role !== ConversationMemberRole.OWNER) throw new ForbiddenException('Chỉ chủ nhóm được xóa nhóm');
    const deletedAt = new Date();
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { deletedAt } });
    return { conversation_id: conversationId, deleted_at: deletedAt.toISOString() };
  }

  async getMemberUserIds(conversationId: string) {
    const rows = await this.prisma.conversationMember.findMany({
      where: { conversationId, leftAt: null },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  }

  async getPushContext(conversationId: string, senderUserId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, deletedAt: null },
      select: {
        type: true,
        title: true,
        members: {
          where: { leftAt: null },
          select: {
            userId: true,
            isMuted: true,
            user: { select: { fullName: true, nickname: true } },
          },
        },
      },
    });
    if (!conversation) return null;
    const sender = conversation.members.find((member) => member.userId === senderUserId);
    if (!sender) return null;
    const senderName = sender.user.nickname ?? sender.user.fullName;
    return {
      senderName,
      conversationTitle: conversation.type === ConversationType.GROUP ? conversation.title : senderName,
      recipientUserIds: conversation.members
        .filter((member) => member.userId !== senderUserId && !member.isMuted)
        .map((member) => member.userId),
    };
  }

  async getConversationItemForUser(userId: string, conversationId: string) {
    return this.getConversation(userId, conversationId);
  }

  async assertMembership(userId: string, conversationId: string) {
    const row = await this.prisma.conversationMember.findFirst({
      where: { userId, conversationId, leftAt: null, conversation: { deletedAt: null } },
    });
    if (!row) throw new ForbiddenException('Bạn không thuộc hội thoại này');
    return row;
  }

  private async assertManager(userId: string, conversationId: string) {
    const member = await this.assertMembership(userId, conversationId);
    const group = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!group || group.type !== ConversationType.GROUP) throw new BadRequestException('Đây không phải hội thoại nhóm');
    const managerRoles: ConversationMemberRole[] = [ConversationMemberRole.OWNER, ConversationMemberRole.ADMIN];
    if (!managerRoles.includes(member.role)) {
      throw new ForbiddenException('Bạn không có quyền quản lý nhóm');
    }
    return member;
  }

  private async assertFriend(userId: string, friendUserId: string) {
    const [friendship, peer] = await Promise.all([
      this.prisma.friendship.findUnique({ where: { userId_friendUserId: { userId, friendUserId } } }),
      this.prisma.user.findFirst({ where: { id: friendUserId, role: UserRole.INVESTOR, status: UserStatus.ACTIVE } }),
    ]);
    if (!peer) throw new NotFoundException('Không tìm thấy tài khoản Mindo');
    if (!friendship) throw new ForbiddenException('Chỉ có thể nhắn tin với bạn bè');
  }

  private async assertFriends(userId: string, friendUserIds: string[]) {
    if (!friendUserIds.length) return;
    const count = await this.prisma.friendship.count({ where: { userId, friendUserId: { in: friendUserIds } } });
    if (count !== friendUserIds.length) throw new ForbiddenException('Chỉ có thể thêm bạn bè vào nhóm');
  }

  private validateMessageBody(dto: CreateChatMessageDto) {
    if (dto.message_type === ChatMessageType.SYSTEM) throw new BadRequestException('Client không được gửi tin hệ thống');
    if (dto.message_type === ChatMessageType.TEXT && !dto.content?.trim()) {
      throw new BadRequestException('Tin nhắn chữ không được để trống');
    }
    if (dto.message_type !== ChatMessageType.TEXT && !dto.attachments?.length) {
      throw new BadRequestException('Tin nhắn ảnh/tệp cần tệp đính kèm');
    }
  }

  private async attachmentRows(userId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const rows = await this.prisma.fileUpload.findMany({ where: { id: { in: unique }, ownerId: userId } });
    if (rows.length !== unique.length) throw new BadRequestException('Có tệp đính kèm không hợp lệ');
    return unique.map((id) => rows.find((row) => row.id === id)!);
  }

  private attachmentSnapshots(rows: FileUpload[]): Prisma.InputJsonValue {
    return rows.map((row) => ({ file_id: row.id, name: row.originalName, mime_type: row.mimeType, size: row.size }));
  }

  private async buildQuotedSnapshot(conversationId: string, messageId: string): Promise<Prisma.InputJsonValue> {
    const source = await this.prisma.chatMessage.findFirst({
      where: { id: messageId, conversationId, deletedAt: null },
      include: { sender: { select: { fullName: true, nickname: true } } },
    });
    if (!source) throw new BadRequestException('Tin nhắn trả lời không hợp lệ');
    const firstAttachment = Array.isArray(source.attachments) ? source.attachments[0] as Record<string, unknown> | undefined : undefined;
    return {
      kind: 'REPLY',
      source_message_id: source.id,
      source_sender_name: source.sender?.nickname ?? source.sender?.fullName ?? 'Tài khoản Mindo',
      source_message_type: source.type,
      content_preview: messagePreview(source.type, source.content).slice(0, 200),
      ...(typeof firstAttachment?.file_id === 'string' ? { attachment_file_id: firstAttachment.file_id } : {}),
    };
  }

  private async ownedMessage(userId: string, messageId: string) {
    const row = await this.prisma.chatMessage.findUnique({ where: { id: messageId } });
    if (!row) throw new NotFoundException('Không tìm thấy tin nhắn');
    await this.assertMembership(userId, row.conversationId);
    if (row.senderId !== userId) throw new ForbiddenException('Bạn không thể sửa hoặc thu hồi tin nhắn của người khác');
    return row;
  }

  /**
   * Tin hệ thống ("… đã tạo nhóm", "… đã thêm 3 thành viên").
   *
   * TRẢ VỀ tin đã dựng xong, không phải `void`, vì nó còn phải được bắn qua
   * Socket.IO. Service không tự bắn được: `ChatRealtimeService` đã import
   * `ChatService` rồi, import ngược lại là vòng tròn. Nên mọi broadcast của
   * cụm này nằm ở controller, và tin hệ thống phải đi ngược lên qua giá trị
   * trả về để tới được đó.
   *
   * Trước khi có đường đi này, tin hệ thống chỉ nằm trong CSDL: người đang
   * mở nhóm không thấy bong bóng nào, trong khi danh sách hội thoại của họ
   * lại đã đổi preview sang đúng câu đó — hai chỗ trên cùng một màn nói hai
   * điều khác nhau cho tới khi tải lại.
   *
   * Dựng payload với góc nhìn của người gây ra sự kiện là đủ cho MỌI người
   * nhận: `is_own` so theo `senderId`, mà tin hệ thống không có người gửi
   * (`null`), còn `is_saved` thì tin vừa tạo chưa ai lưu được.
   */
  private async createSystemMessage(userId: string, conversationId: string, content: string) {
    const row = await this.prisma.chatMessage.create({
      data: { conversationId, type: ChatMessageType.SYSTEM, content },
      include: { sender: true },
    });
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: row.createdAt } });
    return this.serializeMessage(userId, row);
  }

  private async serializeConversationRows(userId: string, rows: ConversationRow[], includeMembers = false) {
    const memberUserIds = rows.flatMap((row) => row.members.map((member) => member.userId));
    const online = await this.presence.onlineMap(memberUserIds);
    const fileIds = [...new Set(rows.flatMap((row) => [
      row.avatarFileId,
      ...row.members.map((member) => member.user.avatarFileId),
    ]).filter((id): id is string => Boolean(id)))];
    const fileRows = fileIds.length ? await this.prisma.fileUpload.findMany({ where: { id: { in: fileIds } } }) : [];
    const files = new Map(fileRows.map((file) => [file.id, file]));
    return Promise.all(rows.map(async (row) => {
      const ownMember = row.members.find((member) => member.userId === userId)!;
      const peers = row.members.filter((member) => member.userId !== userId);
      const peer = peers[0];
      const lastMessage = row.messages[0];
      const unreadCount = await this.prisma.chatMessage.count({
        where: {
          conversationId: row.id,
          deletedAt: null,
          senderId: { not: userId },
          createdAt: { gt: ownMember.lastReadAt ?? ownMember.joinedAt },
        },
      });
      const title = row.type === ConversationType.DIRECT
        ? peer?.user.nickname ?? peer?.user.fullName ?? 'Tài khoản Mindo'
        : row.title ?? 'Nhóm Mindo';
      const avatar = row.type === ConversationType.DIRECT
        ? this.fileUrl(peer?.user.avatarFileId, files)
        : this.fileUrl(row.avatarFileId, files);
      return {
        conversation_id: row.id,
        type: row.type,
        title,
        avatar_url: avatar,
        member_count: row.members.length,
        is_online: row.type === ConversationType.DIRECT ? Boolean(peer && online.get(peer.userId)) : false,
        is_muted: ownMember.isMuted,
        unread_count: unreadCount,
        last_message: lastMessage ? {
          message_id: lastMessage.id,
          sender_user_id: lastMessage.senderId,
          sender_name: lastMessage.sender?.nickname ?? lastMessage.sender?.fullName ?? null,
          is_own: lastMessage.senderId === userId,
          message_type: lastMessage.type,
          preview: lastMessage.deletedAt ? 'Tin nhắn đã được thu hồi' : messagePreview(lastMessage.type, lastMessage.content),
          created_at: lastMessage.createdAt.toISOString(),
        } : null,
        last_message_at: row.lastMessageAt.toISOString(),
        created_at: row.createdAt.toISOString(),
        ...(includeMembers ? {
          members: row.members.map((member) => ({
            ...this.userProfile(member.user, files),
            role: member.role,
            is_online: Boolean(online.get(member.userId)),
            /*
              Mốc đã đọc của TỪNG người. Sự kiện `message:read` chỉ nói cho
              thiết bị đang mở; đóng app rồi mở lại thì không còn gì dựng
              được dấu "đã xem" cho tin cũ. CSDL vẫn giữ mốc này, chỉ là
              trước đây không ai gửi nó ra.
            */
            last_read_message_id: member.lastReadMessageId,
            last_read_at: member.lastReadAt?.toISOString() ?? null,
            joined_at: member.joinedAt.toISOString(),
          })),
        } : {}),
      };
    }));
  }

  private async serializeMessages(userId: string, rows: MessageRow[]) {
    const fileIds = [...new Set(rows.flatMap((row) => {
      if (!Array.isArray(row.attachments)) return [];
      return row.attachments.map((item) => (item as Record<string, unknown>).file_id).filter((id): id is string => typeof id === 'string');
    }))];
    const [fileRows, savedRows] = await Promise.all([
      fileIds.length ? this.prisma.fileUpload.findMany({ where: { id: { in: fileIds } } }) : [],
      rows.length ? this.prisma.savedChatMessage.findMany({ where: { userId, messageId: { in: rows.map((row) => row.id) } }, select: { messageId: true } }) : [],
    ]);
    const files = new Map(fileRows.map((file) => [file.id, file]));
    const saved = new Set(savedRows.map((row) => row.messageId));
    return rows.map((row) => this.serializeMessageWithMaps(userId, row, files, saved));
  }

  private async serializeMessage(userId: string, row: MessageRow) {
    return (await this.serializeMessages(userId, [row]))[0];
  }

  private serializeMessageWithMaps(userId: string, row: MessageRow, files: Map<string, FileUpload>, saved: Set<string>) {
    const attachments = Array.isArray(row.attachments)
      ? row.attachments.map((value) => {
        const item = value as Record<string, unknown>;
        const file = typeof item.file_id === 'string' ? files.get(item.file_id) : undefined;
        return file ? { ...item, url: this.files.view(file).public_url } : item;
      })
      : [];
    return {
      message_id: row.id,
      conversation_id: row.conversationId,
      sender: row.sender ? this.userProfile(row.sender, files) : null,
      is_own: row.senderId === userId,
      message_type: row.type,
      content: row.deletedAt ? null : row.content,
      attachments: row.deletedAt ? [] : attachments,
      reply_to_message_id: row.replyToId,
      quoted_message: row.quotedMessageSnapshot,
      is_saved: saved.has(row.id),
      edited_at: row.editedAt?.toISOString() ?? null,
      deleted_at: row.deletedAt?.toISOString() ?? null,
      client_message_id: row.clientMessageId,
      created_at: row.createdAt.toISOString(),
    };
  }

  private userProfile(user: BasicUser, files: Map<string, FileUpload>) {
    return {
      user_id: user.id,
      full_name: user.fullName,
      nickname: user.nickname ?? user.fullName,
      avatar_url: this.fileUrl(user.avatarFileId, files),
    };
  }

  private fileUrl(fileId: string | null | undefined, files: Map<string, FileUpload>) {
    const file = fileId ? files.get(fileId) : undefined;
    return file ? this.files.view(file).public_url : null;
  }

  private async userName(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true, nickname: true } });
    return user?.nickname ?? user?.fullName ?? 'Một thành viên';
  }
}
