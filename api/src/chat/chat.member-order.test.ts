import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { PrismaService } from '../common/prisma.module';
import { FileStorageService } from '../phase1/file-storage.service';
import { ChatPresenceService } from './chat-presence.service';
import { ChatService } from './chat.service';

/**
 * Thứ tự thành viên nhóm không được đổi giữa hai lần đọc.
 *
 * Thấy trên simulator: người tạo nhóm đứng đầu danh sách thành viên, đổi tên
 * nhóm xong thì tụt xuống cuối. Truy vấn chỉ sắp theo `joinedAt`, mà cả nhóm
 * được tạo trong một giao dịch nên `joinedAt` của mọi người giống hệt nhau —
 * đã soi DB: ba thành viên cùng `2026-09-27 03:21:45.379`. Hoà thì Postgres
 * trả thứ tự tuỳ ý.
 *
 * Prisma ở đây là bản giả nên không sắp thật được; ca này khoá đúng thứ tự
 * sắp gửi xuống truy vấn. Thứ tự thật trên Postgres đã kiểm riêng bằng psql.
 */

function captureInclude() {
  let include: { members?: { orderBy?: unknown } } | undefined;
  const prisma = {
    conversationMember: {
      findFirst: () => Promise.resolve({ userId: 'me', conversationId: 'c-1' }),
    },
    conversation: {
      findFirst: (args: { include: typeof include }) => {
        include = args.include;
        /* Trả rỗng để dừng ngay sau truy vấn — ca này chỉ cần tham số */
        return Promise.resolve(null);
      },
    },
  } as unknown as PrismaService;
  const service = new ChatService(
    prisma,
    {} as FileStorageService,
    {} as ChatPresenceService,
  );
  return { service, include: () => include };
}

describe('thứ tự thành viên', () => {
  it('ai vào trước đứng trước, hoà giờ thì chủ nhóm lên đầu, rồi cố định theo id', async () => {
    const { service, include } = captureInclude();

    await expect(service.getConversation('me', 'c-1')).rejects.toBeInstanceOf(NotFoundException);

    expect(include()?.members?.orderBy).toEqual([
      { joinedAt: 'asc' },
      { role: 'asc' },
      { userId: 'asc' },
    ]);
  });
});
