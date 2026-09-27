import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { FileUpload, Prisma, User, UserRole, UserStatus } from "@prisma/client";
import { isEmail } from "class-validator";
import { pageExtra } from "../common/api-response";
import {
  isNormalizedPhone,
  normalizeEmail,
  normalizePhone,
} from "../common/identity.util";
import { PrismaService } from "../common/prisma.module";
import { FileStorageService } from "../phase1/file-storage.service";
import {
  FriendListQueryDto,
  FriendRequestDirection,
  FriendRequestQueryDto,
} from "./friend.dto";
import { searchKey } from "../chat/chat.domain";

type FriendProfile = Pick<
  User,
  "id" | "email" | "fullName" | "nickname" | "phone" | "avatarFileId"
>;

@Injectable()
export class FriendService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileStorageService,
  ) {}

  async sendRequest(requesterId: string, identifier: string) {
    const recipient = await this.findUserByIdentifier(identifier);
    if (recipient.id === requesterId)
      throw new BadRequestException("Không thể tự kết bạn với chính mình");

    await this.prisma.$transaction(
      async (tx) => {
        await this.lockPair(tx, requesterId, recipient.id);
        const friendship = await tx.friendship.findUnique({
          where: {
            userId_friendUserId: {
              userId: requesterId,
              friendUserId: recipient.id,
            },
          },
        });
        if (friendship)
          throw new ConflictException({
            message: "Hai tài khoản đã là bạn bè",
            code: "ALREADY_FRIENDS",
          });

        const outgoing = await tx.friendRequest.findUnique({
          where: {
            requesterId_recipientId: { requesterId, recipientId: recipient.id },
          },
        });
        if (outgoing)
          throw new ConflictException({
            message: "Lời mời kết bạn đã được gửi",
            code: "REQUEST_ALREADY_SENT",
          });

        const incoming = await tx.friendRequest.findUnique({
          where: {
            requesterId_recipientId: {
              requesterId: recipient.id,
              recipientId: requesterId,
            },
          },
        });
        if (incoming) {
          throw new ConflictException({
            message: "Người này đã gửi lời mời kết bạn cho bạn",
            code: "INCOMING_REQUEST_EXISTS",
            user_id: recipient.id,
          });
        }

        await tx.friendRequest.create({
          data: { requesterId, recipientId: recipient.id },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return {
      direction: FriendRequestDirection.OUTGOING,
      user: await this.profile(recipient, false),
    };
  }

  async list(userId: string, query: FriendListQueryDto) {
    const q = query.q?.trim();
    const where: Prisma.FriendshipWhereInput = {
      userId,
      /* Gõ tên gợi nhớ cũng phải ra người đó: với người đã đặt tên riêng thì
         đó mới là cái tên họ nhớ, chứ không phải họ tên trên giấy tờ.

         Ba cột TÊN so trên bản đã bỏ dấu, nên "Bảo" và "Bao" đều ra. Email
         và số điện thoại giữ nguyên cách cũ — chúng vốn không có dấu, và
         email thì `mode: 'insensitive'` vẫn cần vì không có cột chuẩn hoá. */
      ...(q
        ? {
            OR: [
              { aliasNormalized: { contains: searchKey(q) } },
              {
                friend: {
                  OR: [
                    { fullNameNormalized: { contains: searchKey(q) } },
                    { nicknameNormalized: { contains: searchKey(q) } },
                    { email: { contains: q, mode: "insensitive" as const } },
                    { phone: { contains: q } },
                  ],
                },
              },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.friendship.count({ where }),
      this.prisma.friendship.findMany({
        where,
        include: { friend: true },
        orderBy: [{ createdAt: "desc" }, { friendUserId: "desc" }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    const avatars = await this.avatarFiles(
      rows.map((row) => row.friend),
      rows.map((row) => row.avatarFileId),
    );
    return {
      data: rows.map((row) => {
        const own = row.avatarFileId ? avatars.get(row.avatarFileId) : undefined;
        return {
          ...this.profileWithFiles(row.friend, avatars, true),
          /* Tên gợi nhớ CHỈ của người đang hỏi. Hàng ngược lại có tên khác, hoặc
             không có, và không ai nhìn thấy tên của ai. */
          alias: row.alias,
          /*
            Ảnh riêng mình gán cho họ. Trả RIÊNG chứ không đè lên `avatar_url`:
            màn sửa liên hệ cần biết cái nào là ảnh mình đặt thì mới mời "Xoá
            ảnh hiện tại" đúng lúc, và ảnh hồ sơ thật của họ vẫn phải còn đó
            để rơi về.
          */
          alias_avatar_url: own ? this.files.view(own).public_url : null,
          /* Số / email mình tự ghi. Trả RIÊNG, cùng lý lẽ với ảnh: màn sửa
             phải phân biệt được "mình ghi" với "hồ sơ của họ". */
          alias_phone: row.aliasPhone,
          alias_email: row.aliasEmail,
          friends_since: row.createdAt.toISOString(),
        };
      }),
      extra: pageExtra(query.page, query.limit, total),
    };
  }

  async requests(userId: string, query: FriendRequestQueryDto) {
    const where: Prisma.FriendRequestWhereInput =
      query.direction === FriendRequestDirection.INCOMING
        ? { recipientId: userId }
        : query.direction === FriendRequestDirection.OUTGOING
          ? { requesterId: userId }
          : { OR: [{ requesterId: userId }, { recipientId: userId }] };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.friendRequest.count({ where }),
      this.prisma.friendRequest.findMany({
        where,
        include: { requester: true, recipient: true },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    const users = rows.map((row) =>
      row.requesterId === userId ? row.recipient : row.requester,
    );
    const avatars = await this.avatarFiles(users);
    return {
      data: rows.map((row) => {
        const incoming = row.recipientId === userId;
        const peer = incoming ? row.requester : row.recipient;
        return {
          direction: incoming
            ? FriendRequestDirection.INCOMING
            : FriendRequestDirection.OUTGOING,
          user: this.profileWithFiles(peer, avatars, false),
          created_at: row.createdAt.toISOString(),
        };
      }),
      extra: pageExtra(query.page, query.limit, total),
    };
  }

  async accept(recipientId: string, requesterId: string) {
    const friend = await this.prisma.$transaction(
      async (tx) => {
        await this.lockPair(tx, recipientId, requesterId);
        const request = await tx.friendRequest.findUnique({
          where: { requesterId_recipientId: { requesterId, recipientId } },
          include: { requester: true },
        });
        if (!request)
          throw new NotFoundException("Không tìm thấy lời mời kết bạn");
        await tx.friendship.createMany({
          data: [
            { userId: recipientId, friendUserId: requesterId },
            { userId: requesterId, friendUserId: recipientId },
          ],
          skipDuplicates: true,
        });
        await tx.friendRequest.delete({
          where: { requesterId_recipientId: { requesterId, recipientId } },
        });
        return request.requester;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return { friend: await this.profile(friend, true) };
  }

  async reject(recipientId: string, requesterId: string) {
    const result = await this.prisma.friendRequest.deleteMany({
      where: { requesterId, recipientId },
    });
    if (result.count !== 1)
      throw new NotFoundException("Không tìm thấy lời mời kết bạn");
    return { rejected: true, user_id: requesterId };
  }

  async cancel(requesterId: string, recipientId: string) {
    const result = await this.prisma.friendRequest.deleteMany({
      where: { requesterId, recipientId },
    });
    if (result.count !== 1)
      throw new NotFoundException("Không tìm thấy lời mời kết bạn đã gửi");
    return { cancelled: true, user_id: recipientId };
  }

  /**
   * Đặt hoặc xoá tên gợi nhớ cho một người bạn.
   *
   * MỘT CHIỀU: chỉ đụng hàng `userId → friendUserId`. Người kia không được
   * báo, không thấy gì, và tên họ đặt cho mình vẫn nguyên.
   *
   * Chuỗi rỗng quy về `null` để cột chỉ có một cách diễn đạt "chưa đặt" —
   * nếu không, `''` và `null` cùng nghĩa mà lại lọc khác nhau.
   *
   * `updateMany` thay vì `update`: chưa phải bạn bè thì không có hàng nào và
   * ta trả 404, chứ `update` sẽ ném lỗi Prisma thô ra ngoài.
   */
  /**
   * @param contact số điện thoại / email RIÊNG mình ghi cho người này.
   *
   * Trường nào `undefined` thì KHÔNG đụng tới — đây là PATCH, và màn hình có
   * thể chỉ đổi mỗi cái tên. Chuỗi rỗng mới là xoá, quy về `null` cho cột
   * khỏi mang hai cách nói cùng một nghĩa.
   */
  async setAlias(
    userId: string,
    friendUserId: string,
    alias: string,
    contact: { phone?: string | null; email?: string | null } = {},
  ) {
    const clean = (value: string | null | undefined) =>
      value == null || value.trim() === "" ? null : value.trim();
    const value = clean(alias);
    const data: Prisma.FriendshipUpdateManyMutationInput = { alias: value };
    if (contact.phone !== undefined) data.aliasPhone = clean(contact.phone);
    if (contact.email !== undefined) data.aliasEmail = clean(contact.email);

    const updated = await this.prisma.friendship.updateMany({
      where: { userId, friendUserId },
      data,
    });
    if (updated.count === 0)
      throw new NotFoundException("Hai tài khoản chưa phải bạn bè");
    return {
      user_id: friendUserId,
      alias: value,
      ...(contact.phone === undefined ? {} : { alias_phone: clean(contact.phone) }),
      ...(contact.email === undefined ? {} : { alias_email: clean(contact.email) }),
    };
  }

  /**
   * Gán hoặc xoá ảnh riêng mình đặt cho một người bạn.
   *
   * `fileId` là `null` khi người dùng bấm "Xoá ảnh hiện tại" (978:6072) —
   * trở về ảnh hồ sơ của họ, rồi mới tới chữ cái đầu.
   *
   * Kiểm CHỦ SỞ HỮU trước khi ghi: `fileId` do app gửi lên nên có thể là bất
   * cứ chuỗi nào, và không kiểm thì đoán trúng một id là gán được ảnh riêng
   * tư của người lạ vào danh bạ mình rồi xem thoải mái.
   */
  async setAvatar(userId: string, friendUserId: string, fileId: string | null) {
    if (fileId) {
      const file = await this.files.assertOwned(userId, fileId);
      if (!file.mimeType.startsWith("image/"))
        throw new BadRequestException("Ảnh liên hệ phải là tệp hình ảnh");
    }
    const updated = await this.prisma.friendship.updateMany({
      where: { userId, friendUserId },
      data: { avatarFileId: fileId },
    });
    if (updated.count === 0)
      throw new NotFoundException("Hai tài khoản chưa phải bạn bè");
    return { user_id: friendUserId, avatar_file_id: fileId };
  }

  async remove(userId: string, friendUserId: string) {
    const deleted = await this.prisma.$transaction(
      async (tx) => {
        await this.lockPair(tx, userId, friendUserId);
        return tx.friendship.deleteMany({
          where: {
            OR: [
              { userId, friendUserId },
              { userId: friendUserId, friendUserId: userId },
            ],
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (deleted.count === 0)
      throw new NotFoundException("Hai tài khoản chưa phải bạn bè");
    return { removed: true, user_id: friendUserId };
  }

  private async findUserByIdentifier(identifier: string) {
    const value = identifier.trim();
    const where: Prisma.UserWhereUniqueInput = value.includes("@")
      ? this.emailWhere(value)
      : this.phoneWhere(value);
    const user = await this.prisma.user.findUnique({ where });
    if (
      !user ||
      user.role !== UserRole.INVESTOR ||
      user.status !== UserStatus.ACTIVE
    ) {
      throw new NotFoundException(
        "Không tìm thấy tài khoản Mindo với thông tin này",
      );
    }
    return user;
  }

  private emailWhere(value: string): Prisma.UserWhereUniqueInput {
    const email = normalizeEmail(value);
    if (!isEmail(email))
      throw new BadRequestException("Email hoặc số điện thoại không hợp lệ");
    return { email };
  }

  private phoneWhere(value: string): Prisma.UserWhereUniqueInput {
    const phoneNormalized = normalizePhone(value);
    if (!isNormalizedPhone(phoneNormalized))
      throw new BadRequestException("Email hoặc số điện thoại không hợp lệ");
    return { phoneNormalized };
  }

  private async lockPair(
    tx: Prisma.TransactionClient,
    first: string,
    second: string,
  ) {
    for (const userId of [first, second].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mindo-friend:${userId}`}))`;
    }
  }

  private async profile(user: FriendProfile, includeContact: boolean) {
    const avatars = await this.avatarFiles([user]);
    return this.profileWithFiles(user, avatars, includeContact);
  }

  /**
   * @param extraIds id tệp KHÔNG thuộc hồ sơ người dùng — hiện là ảnh riêng
   * mình gán cho bạn (`Friendship.avatarFileId`). Gộp vào cùng một lượt đọc
   * để danh sách bạn bè vẫn chỉ tốn đúng một truy vấn tệp.
   */
  private async avatarFiles(
    users: FriendProfile[],
    extraIds: (string | null | undefined)[] = [],
  ) {
    const ids = [
      ...new Set(
        [...users.map((user) => user.avatarFileId), ...extraIds].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    ];
    const rows = ids.length
      ? await this.prisma.fileUpload.findMany({ where: { id: { in: ids } } })
      : [];
    return new Map(rows.map((row) => [row.id, row]));
  }

  private profileWithFiles(
    user: FriendProfile,
    files: Map<string, FileUpload>,
    includeContact: boolean,
  ) {
    const avatar = user.avatarFileId ? files.get(user.avatarFileId) : undefined;
    return {
      user_id: user.id,
      full_name: user.fullName,
      nickname: user.nickname ?? user.fullName,
      avatar_url: avatar ? this.files.view(avatar).public_url : null,
      ...(includeContact
        ? { email: user.email, phone_number: user.phone ?? "" }
        : {}),
    };
  }
}
