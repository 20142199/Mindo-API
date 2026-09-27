import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../common/prisma.module';
import { FileStorageService } from '../phase1/file-storage.service';
import { FriendService } from './friend.service';
import { FriendListQueryDto } from './friend.dto';

/**
 * Ảnh riêng mình gán cho một người bạn — Figma 978:5979 / 978:6011 (2026-09-27).
 *
 * Cùng lý do với `alias`, chỉ khác là ảnh thay vì tên: `User.avatarFileId` là
 * ảnh CHỦ TÀI KHOẢN tự đặt, mình không đặt hộ được. Nhưng "trong danh bạ của
 * tôi, người này trông như thế này" thì là chuyện riêng của tôi.
 *
 * Hai thứ dễ làm sai, nên khoá lại ở đây:
 *
 *   1. GÁN ẢNH CỦA NGƯỜI KHÁC. `fileId` do app gửi lên, mà app thì gửi được
 *      bất cứ chuỗi nào. Không kiểm chủ sở hữu thì đoán trúng một id là xem
 *      được ảnh riêng tư của người lạ.
 *   2. GÁN MỘT TỆP KHÔNG PHẢI ẢNH. Một file PDF lọt vào đây thì danh bạ có
 *      một ô vỡ, và không có gì nói vì sao.
 */

function serviceWith(
  prisma: Partial<PrismaService>,
  files: Partial<FileStorageService> = {},
) {
  return new FriendService(
    prisma as PrismaService,
    { view: () => ({ public_url: null }), ...files } as unknown as FileStorageService,
  );
}

const imageFile = { id: 'f-1', mimeType: 'image/jpeg' };

describe('gán ảnh riêng cho liên hệ', () => {
  it('ghi đúng một hàng: của mình, cho người kia', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const assertOwned = vi.fn().mockResolvedValue(imageFile);
    const service = serviceWith({ friendship: { updateMany } } as never, {
      assertOwned,
    } as never);

    await service.setAvatar('u-me', 'u-ban', 'f-1');

    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'u-me', friendUserId: 'u-ban' },
      data: { avatarFileId: 'f-1' },
    });
  });

  /* "Xoá ảnh hiện tại" trong sheet 978:6072 — trở về ảnh hồ sơ của họ. */
  it('gửi null là xoá ảnh, và không đụng tới kho tệp', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const assertOwned = vi.fn();
    const service = serviceWith({ friendship: { updateMany } } as never, {
      assertOwned,
    } as never);

    const result = await service.setAvatar('u-me', 'u-ban', null);

    expect(updateMany.mock.calls[0][0].data).toEqual({ avatarFileId: null });
    expect(assertOwned).not.toHaveBeenCalled();
    expect(result).toEqual({ user_id: 'u-ban', avatar_file_id: null });
  });

  /* Tệp phải là CỦA NGƯỜI GỌI. `assertOwned` ném thì cả lời gọi phải hỏng,
     không được lặng lẽ ghi vào CSDL rồi mới kêu. */
  it('không gán được tệp của người khác', async () => {
    const updateMany = vi.fn();
    const assertOwned = vi.fn().mockRejectedValue(new NotFoundException('x'));
    const service = serviceWith({ friendship: { updateMany } } as never, {
      assertOwned,
    } as never);

    await expect(service.setAvatar('u-me', 'u-ban', 'f-cua-nguoi-khac')).rejects.toThrow();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('không gán được tệp không phải ảnh', async () => {
    const updateMany = vi.fn();
    const assertOwned = vi.fn().mockResolvedValue({ id: 'f-2', mimeType: 'application/pdf' });
    const service = serviceWith({ friendship: { updateMany } } as never, {
      assertOwned,
    } as never);

    await expect(service.setAvatar('u-me', 'u-ban', 'f-2')).rejects.toThrow(BadRequestException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  /* Chưa là bạn bè thì không có hàng nào để ghi. Im lặng bỏ qua thì app
     tưởng đã lưu xong. */
  it('chưa phải bạn bè thì báo không tìm thấy', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const service = serviceWith({ friendship: { updateMany } } as never, {
      assertOwned: vi.fn().mockResolvedValue(imageFile),
    } as never);

    await expect(service.setAvatar('u-me', 'u-la', 'f-1')).rejects.toThrow(NotFoundException);
  });
});

describe('ảnh riêng trong danh sách bạn bè', () => {
  const friendRow = (avatarFileId: string | null) => ({
    alias: null,
    avatarFileId,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    friendUserId: 'u-ban',
    friend: {
      id: 'u-ban',
      email: 'ban@x.vn',
      fullName: 'Hà Linh',
      nickname: null,
      phone: null,
      avatarFileId: 'f-ho-so',
    },
  });

  function listWith(row: ReturnType<typeof friendRow>) {
    const prisma = {
      $transaction: (work: unknown[]) => Promise.all(work),
      friendship: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([row]),
      },
      fileUpload: {
        findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.map((id) => ({ id, mimeType: 'image/jpeg' })),
        ),
      },
    } as unknown as PrismaService;

    const service = new FriendService(prisma, {
      view: (file: { id: string }) => ({ public_url: `https://cdn/${file.id}` }),
    } as unknown as FileStorageService);

    return { service, prisma };
  }

  it('trả ảnh riêng RIÊNG, không đè lên ảnh hồ sơ', async () => {
    const { service } = listWith(friendRow('f-rieng'));

    const result = await service.list('u-me', new FriendListQueryDto());
    const row = result.data[0] as Record<string, unknown>;

    expect(row.alias_avatar_url).toBe('https://cdn/f-rieng');
    /* Ảnh hồ sơ THẬT của họ vẫn còn — màn sửa cần nó để rơi về khi xoá. */
    expect(row.avatar_url).toBe('https://cdn/f-ho-so');
  });

  it('chưa gán ảnh riêng thì trả null', async () => {
    const { service } = listWith(friendRow(null));

    const result = await service.list('u-me', new FriendListQueryDto());

    expect((result.data[0] as Record<string, unknown>).alias_avatar_url).toBeNull();
  });

  /* Ảnh riêng gộp chung vào lượt đọc tệp của ảnh hồ sơ — thêm một truy vấn
     nữa cho mỗi trang danh bạ là thừa. */
  it('vẫn chỉ đọc kho tệp đúng một lần', async () => {
    const { service, prisma } = listWith(friendRow('f-rieng'));

    await service.list('u-me', new FriendListQueryDto());

    expect((prisma as never as { fileUpload: { findMany: { mock: { calls: unknown[] } } } }).fileUpload.findMany.mock.calls).toHaveLength(1);
  });
});

/**
 * Số điện thoại và email RIÊNG mình ghi cho một người bạn.
 *
 * Bộ thứ ba theo cùng khuôn `alias` / `avatarFileId`. Số họ khai trong tài
 * khoản Mindo có thể trống, hoặc không phải số mình hay gọi — cuốn danh bạ
 * của tôi thì ghi theo cách tôi biết về họ.
 */
describe('số và email riêng ghi cho liên hệ', () => {
  const build = () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    return { updateMany, service: serviceWith({ friendship: { updateMany } } as never) };
  };

  it('ghi cả ba cùng một lượt', async () => {
    const { service, updateMany } = build();

    await service.setAlias('u-me', 'u-ban', 'Sếp Anna', {
      phone: '0901 234 567 (nhà)',
      email: 'anna@congty.vn',
    });

    expect(updateMany.mock.calls[0][0].data).toEqual({
      alias: 'Sếp Anna',
      aliasPhone: '0901 234 567 (nhà)',
      aliasEmail: 'anna@congty.vn',
    });
  });

  /*
    ĐÂY LÀ CA GIỮ TƯƠNG THÍCH. Màn hình có thể chỉ đổi mỗi cái tên, và PATCH
    thì trường vắng mặt nghĩa là KHÔNG ĐỔI. Nếu cứ ghi cả ba thì một lần đổi
    tên sẽ lặng lẽ xoá sạch số và email đã ghi.
  */
  it('không truyền thì không đụng tới hai cột kia', async () => {
    const { service, updateMany } = build();

    await service.setAlias('u-me', 'u-ban', 'Sếp Anna');

    expect(updateMany.mock.calls[0][0].data).toEqual({ alias: 'Sếp Anna' });
  });

  it('chuỗi rỗng là xoá, lưu thành null', async () => {
    const { service, updateMany } = build();

    await service.setAlias('u-me', 'u-ban', 'Anna', { phone: '  ', email: '' });

    expect(updateMany.mock.calls[0][0].data).toEqual({
      alias: 'Anna',
      aliasPhone: null,
      aliasEmail: null,
    });
  });

  /* Đổi một trong hai không được kéo cái kia theo. */
  it('đổi riêng số thì email giữ nguyên', async () => {
    const { service, updateMany } = build();

    await service.setAlias('u-me', 'u-ban', 'Anna', { phone: '0909' });

    expect(updateMany.mock.calls[0][0].data).toEqual({
      alias: 'Anna',
      aliasPhone: '0909',
    });
  });
});
