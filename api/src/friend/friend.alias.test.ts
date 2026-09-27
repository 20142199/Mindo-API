import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../common/prisma.module';
import { FileStorageService } from '../phase1/file-storage.service';
import { FriendService } from './friend.service';
import { FriendListQueryDto } from './friend.dto';

/**
 * Tên gợi nhớ tự đặt cho một người bạn (2026-09-27).
 *
 * `User.nickname` KHÔNG dùng được cho việc này: đó là tên do chính chủ tài
 * khoản đặt cho mình, ai nhìn cũng thấy y hệt. Còn tên gợi nhớ là chuyện riêng
 * của một phía — A gọi B là "Sếp" thì B không được biết, và cái tên B đặt cho
 * A vẫn nguyên. Nên nó nằm ở `Friendship`, bảng vốn đã một chiều.
 */

const files = { view: () => ({ public_url: null }) } as unknown as FileStorageService;

function serviceWith(prisma: Partial<PrismaService>) {
  return new FriendService(prisma as PrismaService, files);
}

describe('đặt tên gợi nhớ', () => {
  it('ghi đúng một hàng: của mình, cho người kia', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = serviceWith({ friendship: { updateMany } } as never);

    await service.setAlias('u-me', 'u-ban', 'Sếp Anna');

    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'u-me', friendUserId: 'u-ban' },
      data: { alias: 'Sếp Anna' },
    });
  });

  /* Xoá trắng ô nhập rồi lưu = xoá tên gợi nhớ. Phải ra `null` chứ không phải
     chuỗi rỗng, nếu không cột mang hai cách nói cùng một nghĩa. */
  it('chuỗi rỗng là xoá, và lưu thành null', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = serviceWith({ friendship: { updateMany } } as never);

    const result = await service.setAlias('u-me', 'u-ban', '   ');

    expect(updateMany.mock.calls[0][0].data).toEqual({ alias: null });
    expect(result).toEqual({ user_id: 'u-ban', alias: null });
  });

  /* Chưa phải bạn bè thì không có hàng nào để ghi — phải là 404 chứ không
     phải "thành công" im lặng. */
  it('chưa phải bạn bè thì báo không tìm thấy', async () => {
    const service = serviceWith({
      friendship: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    } as never);

    await expect(service.setAlias('u-me', 'u-la', 'Ai đó')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('danh sách bạn bè mang theo tên gợi nhớ', () => {
  const row = {
    alias: 'Sếp Anna',
    createdAt: new Date('2026-09-20T08:00:00.000Z'),
    friend: {
      id: 'u-ban',
      email: 'anna@example.com',
      fullName: 'Anna Nguyễn',
      nickname: 'Anna',
      phone: '0912345678',
      avatarFileId: null,
    },
  };

  const prisma = {
    $transaction: vi.fn().mockResolvedValue([1, [row]]),
    fileUpload: { findMany: vi.fn().mockResolvedValue([]) },
    friendship: { count: vi.fn(), findMany: vi.fn() },
  };

  it('trả `alias` để app biết mà hiện thay cho nickname', async () => {
    const service = serviceWith(prisma as never);

    const result = await service.list('u-me', new FriendListQueryDto());

    expect(result.data[0]).toMatchObject({
      user_id: 'u-ban',
      nickname: 'Anna',
      alias: 'Sếp Anna',
    });
  });

  /* Chưa đặt thì `null` — app rơi về nickname. Không tự điền nickname vào đây,
     vì khi đó app không phân biệt được "chưa đặt" với "đặt trùng nickname". */
  it('chưa đặt thì alias là null', async () => {
    const service = serviceWith({
      ...prisma,
      $transaction: vi.fn().mockResolvedValue([1, [{ ...row, alias: null }]]),
    } as never);

    const result = await service.list('u-me', new FriendListQueryDto());

    expect(result.data[0].alias).toBeNull();
  });
});
