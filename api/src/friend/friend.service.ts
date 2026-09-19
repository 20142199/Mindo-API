import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FileUpload, Prisma, User, UserRole, UserStatus } from '@prisma/client';
import { isEmail } from 'class-validator';
import { pageExtra } from '../common/api-response';
import { isNormalizedPhone, normalizeEmail, normalizePhone } from '../common/identity.util';
import { PrismaService } from '../common/prisma.module';
import { FileStorageService } from '../phase1/file-storage.service';
import { FriendListQueryDto, FriendRequestDirection, FriendRequestQueryDto } from './friend.dto';

type FriendProfile = Pick<User, 'id' | 'email' | 'fullName' | 'nickname' | 'phone' | 'avatarFileId'>;

@Injectable()
export class FriendService {
  constructor(private readonly prisma: PrismaService, private readonly files: FileStorageService) {}

  async sendRequest(requesterId: string, identifier: string) {
    const recipient = await this.findUserByIdentifier(identifier);
    if (recipient.id === requesterId) throw new BadRequestException('Không thể tự kết bạn với chính mình');

    await this.prisma.$transaction(async (tx) => {
      await this.lockPair(tx, requesterId, recipient.id);
      const friendship = await tx.friendship.findUnique({
        where: { userId_friendUserId: { userId: requesterId, friendUserId: recipient.id } },
      });
      if (friendship) throw new ConflictException({ message: 'Hai tài khoản đã là bạn bè', code: 'ALREADY_FRIENDS' });

      const outgoing = await tx.friendRequest.findUnique({
        where: { requesterId_recipientId: { requesterId, recipientId: recipient.id } },
      });
      if (outgoing) throw new ConflictException({ message: 'Lời mời kết bạn đã được gửi', code: 'REQUEST_ALREADY_SENT' });

      const incoming = await tx.friendRequest.findUnique({
        where: { requesterId_recipientId: { requesterId: recipient.id, recipientId: requesterId } },
      });
      if (incoming) {
        throw new ConflictException({
          message: 'Người này đã gửi lời mời kết bạn cho bạn',
          code: 'INCOMING_REQUEST_EXISTS',
          user_id: recipient.id,
        });
      }

      await tx.friendRequest.create({ data: { requesterId, recipientId: recipient.id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return {
      direction: FriendRequestDirection.OUTGOING,
      user: await this.profile(recipient, false),
    };
  }

  async list(userId: string, query: FriendListQueryDto) {
    const q = query.q?.trim();
    const where: Prisma.FriendshipWhereInput = {
      userId,
      ...(q ? {
        friend: {
          OR: [
            { fullName: { contains: q, mode: 'insensitive' } },
            { nickname: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
          ],
        },
      } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.friendship.count({ where }),
      this.prisma.friendship.findMany({
        where,
        include: { friend: true },
        orderBy: [{ createdAt: 'desc' }, { friendUserId: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    const avatars = await this.avatarFiles(rows.map((row) => row.friend));
    return {
      data: rows.map((row) => ({
        ...this.profileWithFiles(row.friend, avatars, true),
        friends_since: row.createdAt.toISOString(),
      })),
      extra: pageExtra(query.page, query.limit, total),
    };
  }

  async requests(userId: string, query: FriendRequestQueryDto) {
    const where: Prisma.FriendRequestWhereInput = query.direction === FriendRequestDirection.INCOMING
      ? { recipientId: userId }
      : query.direction === FriendRequestDirection.OUTGOING
        ? { requesterId: userId }
        : { OR: [{ requesterId: userId }, { recipientId: userId }] };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.friendRequest.count({ where }),
      this.prisma.friendRequest.findMany({
        where,
        include: { requester: true, recipient: true },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    const users = rows.map((row) => row.requesterId === userId ? row.recipient : row.requester);
    const avatars = await this.avatarFiles(users);
    return {
      data: rows.map((row) => {
        const incoming = row.recipientId === userId;
        const peer = incoming ? row.requester : row.recipient;
        return {
          direction: incoming ? FriendRequestDirection.INCOMING : FriendRequestDirection.OUTGOING,
          user: this.profileWithFiles(peer, avatars, false),
          created_at: row.createdAt.toISOString(),
        };
      }),
      extra: pageExtra(query.page, query.limit, total),
    };
  }

  async accept(recipientId: string, requesterId: string) {
    const friend = await this.prisma.$transaction(async (tx) => {
      await this.lockPair(tx, recipientId, requesterId);
      const request = await tx.friendRequest.findUnique({
        where: { requesterId_recipientId: { requesterId, recipientId } },
        include: { requester: true },
      });
      if (!request) throw new NotFoundException('Không tìm thấy lời mời kết bạn');
      await tx.friendship.createMany({
        data: [
          { userId: recipientId, friendUserId: requesterId },
          { userId: requesterId, friendUserId: recipientId },
        ],
        skipDuplicates: true,
      });
      await tx.friendRequest.delete({ where: { requesterId_recipientId: { requesterId, recipientId } } });
      return request.requester;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { friend: await this.profile(friend, true) };
  }

  async reject(recipientId: string, requesterId: string) {
    const result = await this.prisma.friendRequest.deleteMany({ where: { requesterId, recipientId } });
    if (result.count !== 1) throw new NotFoundException('Không tìm thấy lời mời kết bạn');
    return { rejected: true, user_id: requesterId };
  }

  async cancel(requesterId: string, recipientId: string) {
    const result = await this.prisma.friendRequest.deleteMany({ where: { requesterId, recipientId } });
    if (result.count !== 1) throw new NotFoundException('Không tìm thấy lời mời kết bạn đã gửi');
    return { cancelled: true, user_id: recipientId };
  }

  async remove(userId: string, friendUserId: string) {
    const deleted = await this.prisma.$transaction(async (tx) => {
      await this.lockPair(tx, userId, friendUserId);
      return tx.friendship.deleteMany({
        where: {
          OR: [
            { userId, friendUserId },
            { userId: friendUserId, friendUserId: userId },
          ],
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (deleted.count === 0) throw new NotFoundException('Hai tài khoản chưa phải bạn bè');
    return { removed: true, user_id: friendUserId };
  }

  private async findUserByIdentifier(identifier: string) {
    const value = identifier.trim();
    const where: Prisma.UserWhereUniqueInput = value.includes('@')
      ? this.emailWhere(value)
      : this.phoneWhere(value);
    const user = await this.prisma.user.findUnique({ where });
    if (!user || user.role !== UserRole.INVESTOR || user.status !== UserStatus.ACTIVE) {
      throw new NotFoundException('Không tìm thấy tài khoản Mindo với thông tin này');
    }
    return user;
  }

  private emailWhere(value: string): Prisma.UserWhereUniqueInput {
    const email = normalizeEmail(value);
    if (!isEmail(email)) throw new BadRequestException('Email hoặc số điện thoại không hợp lệ');
    return { email };
  }

  private phoneWhere(value: string): Prisma.UserWhereUniqueInput {
    const phoneNormalized = normalizePhone(value);
    if (!isNormalizedPhone(phoneNormalized)) throw new BadRequestException('Email hoặc số điện thoại không hợp lệ');
    return { phoneNormalized };
  }

  private async lockPair(tx: Prisma.TransactionClient, first: string, second: string) {
    for (const userId of [first, second].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mindo-friend:${userId}`}))`;
    }
  }

  private async profile(user: FriendProfile, includeContact: boolean) {
    const avatars = await this.avatarFiles([user]);
    return this.profileWithFiles(user, avatars, includeContact);
  }

  private async avatarFiles(users: FriendProfile[]) {
    const ids = [...new Set(users.map((user) => user.avatarFileId).filter((id): id is string => Boolean(id)))];
    const rows = ids.length ? await this.prisma.fileUpload.findMany({ where: { id: { in: ids } } }) : [];
    return new Map(rows.map((row) => [row.id, row]));
  }

  private profileWithFiles(user: FriendProfile, files: Map<string, FileUpload>, includeContact: boolean) {
    const avatar = user.avatarFileId ? files.get(user.avatarFileId) : undefined;
    return {
      user_id: user.id,
      full_name: user.fullName,
      nickname: user.nickname ?? user.fullName,
      avatar_url: avatar ? this.files.view(avatar).public_url : null,
      ...(includeContact ? { email: user.email, phone_number: user.phone ?? '' } : {}),
    };
  }
}
