import { ConversationType, Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../common/prisma.module';
import { ChatService } from './chat.service';
import { ChatPageQueryDto } from './chat.dto';

/**
 * Màn tìm kiếm chia ba tab: Tất cả · Tin nhắn · Nhóm (2026-09-27).
 *
 * Lọc phía app thì hỏng phân trang — danh sách chỉ có trang đầu, nên tab
 * "Nhóm" sẽ bỏ sót mọi nhóm nằm từ trang hai trở đi. Nên lọc ở nơi biết toàn
 * bộ dữ liệu: thêm `type` vào truy vấn.
 *
 * Tệp này cũng khoá một thay đổi HÀNH VI: tìm kiếm thôi khớp theo nội dung
 * tin nhắn. Lý do ở ngay chỗ mệnh đề bị gỡ trong `chat.service.ts`.
 */

type FindManyArgs = { where: Prisma.ConversationWhereInput };

function buildService() {
  const findMany = vi.fn((_args: FindManyArgs) => Promise.resolve([]));
  const count = vi.fn(() => Promise.resolve(0));
  const prisma = {
    $transaction: (work: unknown[]) => Promise.all(work),
    conversation: { count, findMany },
    chatMessage: { count: vi.fn(() => Promise.resolve(0)) },
    fileUpload: { findMany: vi.fn(() => Promise.resolve([])) },
  } as unknown as PrismaService;

  const service = new ChatService(
    prisma,
    { view: () => ({ public_url: 'https://x' }) } as never,
    { onlineMap: () => Promise.resolve(new Map<string, boolean>()) } as never,
  );
  return { service, findMany };
}

async function whereOf(query: Partial<ChatPageQueryDto>) {
  const { service, findMany } = buildService();
  await service.listConversations('u-me', { page: 1, limit: 20, ...query } as ChatPageQueryDto);
  return findMany.mock.calls[0][0].where;
}

describe('lọc danh sách hội thoại theo loại', () => {
  it('tab Tin nhắn chỉ lấy hội thoại 1-1', async () => {
    expect((await whereOf({ type: ConversationType.DIRECT })).type).toBe(ConversationType.DIRECT);
  });

  it('tab Nhóm chỉ lấy nhóm', async () => {
    expect((await whereOf({ type: ConversationType.GROUP })).type).toBe(ConversationType.GROUP);
  });

  /* Tab "Tất cả" và màn danh sách thường đều không truyền `type` — truy vấn
     phải KHÔNG có khoá đó, chứ không phải có với giá trị undefined. */
  it('không truyền type thì không lọc', async () => {
    expect(await whereOf({})).not.toHaveProperty('type');
  });

  it('vẫn giữ nguyên điều kiện thành viên khi có lọc', async () => {
    const where = await whereOf({ type: ConversationType.GROUP });

    expect(where.deletedAt).toBeNull();
    expect(where.members).toEqual({ some: { userId: 'u-me', leftAt: null, isHidden: false } });
  });
});

describe('phạm vi tìm kiếm', () => {
  /*
    Tìm theo TÊN, không theo nội dung tin.

    Mệnh đề cũ `messages: { some: { content: contains q } }` trả về HỘI THOẠI
    chứ không trả về tin khớp, mà màn hình không hiện đoạn trích nào — người
    dùng gõ một chữ rồi thấy một hội thoại lạ nhảy ra, không có gì giải thích
    vì sao. Nó cũng là mệnh đề đắt nhất: `ILIKE` quét bảng tin nhắn, không có
    index full-text lẫn trigram.
  */
  it('khớp theo tên nhóm và tên thành viên, không theo nội dung tin', async () => {
    const where = await whereOf({ q: 'anna' });

    expect(where.OR).toHaveLength(2);
    expect(where.OR?.some((clause) => 'messages' in clause)).toBe(false);
    expect(where.OR?.some((clause) => 'titleNormalized' in clause)).toBe(true);
    expect(where.OR?.some((clause) => 'members' in clause)).toBe(true);
  });

  /*
    Tìm trên cột ĐÃ BỎ DẤU, và từ khoá cũng phải bỏ dấu trước khi so. Gõ có
    dấu hay không dấu vì thế đều quy về một chuỗi và cùng ra kết quả.
  */
  it.each([['Đầu tư'], ['dau tu'], ['ĐẦU TƯ']])(
    'từ khoá %s được quy về "dau tu"',
    async (typed) => {
      const where = await whereOf({ q: typed });
      const title = where.OR?.find((c) => 'titleNormalized' in c) as
        | { titleNormalized: { contains: string } }
        | undefined;

      expect(title?.titleNormalized.contains).toBe('dau tu');
    },
  );

  /* Cả hai vế đã hạ chữ thường, nên `mode: 'insensitive'` vừa thừa vừa làm
     mất index trigram (`ILIKE` không dùng được nó). */
  it('không dùng mode insensitive nữa', async () => {
    const where = await whereOf({ q: 'Anna' });

    expect(JSON.stringify(where.OR)).not.toContain('insensitive');
  });

  it('không có từ khoá thì không dựng OR', async () => {
    expect(await whereOf({})).not.toHaveProperty('OR');
  });

  /* Lọc loại và tìm từ khoá phải chồng được lên nhau — đó chính là tab
     "Nhóm" khi người dùng đang gõ. */
  it('lọc loại và từ khoá đi cùng nhau', async () => {
    const where = await whereOf({ q: 'quỹ', type: ConversationType.GROUP });

    expect(where.type).toBe(ConversationType.GROUP);
    expect(where.OR).toHaveLength(2);
  });
});

describe('xác thực tham số type', () => {
  const dto = (raw: Record<string, unknown>) =>
    validateSync(plainToInstance(ChatPageQueryDto, raw));

  it.each([ConversationType.DIRECT, ConversationType.GROUP])('nhận %s', (type) => {
    expect(dto({ type })).toHaveLength(0);
  });

  it('từ chối giá trị lạ', () => {
    expect(dto({ type: 'BANANA' }).length).toBeGreaterThan(0);
  });

  it('vắng mặt vẫn hợp lệ', () => {
    expect(dto({})).toHaveLength(0);
  });
});
