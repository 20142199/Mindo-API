import { ConflictException, GoneException, NotFoundException } from '@nestjs/common';
import { WebLoginStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../common/prisma.module';
import { AuthService } from './auth.service';
import { WebLoginService } from './web-login.service';

/**
 * Vòng đời mã QR đăng nhập web — xem docs/web-qr-login-design.md.
 *
 * Prisma giả ở đây THỰC THI điều kiện `where` của `updateMany` (id, status,
 * userId, `expiresAt.gt`), vì toàn bộ độ an toàn của tính năng nằm ở chỗ mỗi
 * bước chuyển là một câu UPDATE có điều kiện: hai bên tranh nhau thì chỉ một
 * bên đổi được hàng. Một bản giả luôn trả `count: 1` sẽ cho mọi ca tranh chấp
 * xanh vô nghĩa.
 */

type Row = {
  id: string;
  secretHash: string;
  status: WebLoginStatus;
  userId: string | null;
  browser: string | null;
  ipAddress: string | null;
  expiresAt: Date;
  createdAt: Date;
  scannedAt: Date | null;
  decidedAt: Date | null;
};

const ACTIVE_USERS = { me: { status: 'ACTIVE' }, other: { status: 'ACTIVE' } };

function build(users: Record<string, { status: string }> = ACTIVE_USERS) {
  const rows = new Map<string, Row>();
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) =>
      key === 'expiresAt'
        ? row.expiresAt > (value as { gt: Date }).gt
        : (row as unknown as Record<string, unknown>)[key] === value,
    );
  const prisma = {
    webLoginRequest: {
      create: vi.fn(({ data }: { data: Partial<Row> }) => {
        const row = {
          status: WebLoginStatus.PENDING,
          userId: null,
          browser: null,
          ipAddress: null,
          createdAt: new Date(),
          scannedAt: null,
          decidedAt: null,
          ...data,
        } as Row;
        rows.set(row.id, row);
        return Promise.resolve(row);
      }),
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.has(where.id) ? { ...rows.get(where.id)! } : null),
      ),
      updateMany: vi.fn(({ where, data }: { where: Record<string, unknown> & { id: string }; data: Partial<Row> }) => {
        const row = rows.get(where.id);
        if (!row || !matches(row, where)) return Promise.resolve({ count: 0 });
        Object.assign(row, data);
        return Promise.resolve({ count: 1 });
      }),
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
    },
    user: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(users[where.id] ? { id: where.id, ...users[where.id] } : null),
      ),
    },
  } as unknown as PrismaService;
  const issueWebSession = vi.fn(() =>
    Promise.resolve({ user: {}, access_token: 'at', refresh_token: 'rt', session_id: 'sid' }),
  );
  const service = new WebLoginService(prisma, { issueWebSession } as unknown as AuthService);
  return { service, rows, issueWebSession };
}

const expire = (rows: Map<string, Row>, id: string) => {
  rows.get(id)!.expiresAt = new Date(Date.now() - 1);
};

describe('WebLoginService', () => {
  it('tạo mã: QR chỉ chứa id, khoá không lưu nguyên văn', async () => {
    const { service, rows } = build();
    const created = await service.create({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/129.0 Safari/537.36',
    });

    expect(created.qr_value).toBe(`mindo://web-login?session=${created.session_id}`);
    expect(created.qr_value).not.toContain(created.secret);
    expect(rows.get(created.session_id)!.secretHash).not.toBe(created.secret);
    expect(rows.get(created.session_id)!.browser).toBe('Chrome trên macOS');
  });

  it('sai khoá thì như không tồn tại', async () => {
    const { service } = build();
    const { session_id } = await service.create({});

    await expect(service.poll(session_id, 'khoa-sai', {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('chờ quét → đã quét → duyệt → web nhận token đúng MỘT lần', async () => {
    const { service, issueWebSession } = build();
    const { session_id, secret } = await service.create({});

    expect(await service.poll(session_id, secret, {})).toEqual({ status: 'pending' });
    await service.scan('me', session_id);
    expect(await service.poll(session_id, secret, {})).toEqual({ status: 'scanned' });
    await service.decide('me', session_id, true);
    expect(await service.poll(session_id, secret, {})).toMatchObject({ status: 'approved', access_token: 'at' });
    expect(await service.poll(session_id, secret, {})).toEqual({ status: 'expired' });
    expect(issueWebSession).toHaveBeenCalledTimes(1);
  });

  it('hai lần poll cùng lúc sau khi duyệt: chỉ một bên có token', async () => {
    const { service, issueWebSession } = build();
    const { session_id, secret } = await service.create({});
    await service.scan('me', session_id);
    await service.decide('me', session_id, true);

    const results = await Promise.all([
      service.poll(session_id, secret, {}),
      service.poll(session_id, secret, {}),
    ]);

    expect(results.filter((result) => result.status === 'approved')).toHaveLength(1);
    expect(issueWebSession).toHaveBeenCalledTimes(1);
  });

  it('từ chối thì web thấy rejected', async () => {
    const { service } = build();
    const { session_id, secret } = await service.create({});
    await service.scan('me', session_id);
    await service.decide('me', session_id, false);

    expect(await service.poll(session_id, secret, {})).toEqual({ status: 'rejected' });
  });

  it('người khác đã quét trước thì 409; người khác duyệt hộ thì không được', async () => {
    const { service } = build();
    const { session_id } = await service.create({});
    await service.scan('me', session_id);

    await expect(service.scan('other', session_id)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.decide('other', session_id, true)).rejects.toBeInstanceOf(GoneException);
  });

  it('cùng người quét lại thì trả lại thông tin, không lỗi', async () => {
    const { service } = build();
    const { session_id } = await service.create({});
    const first = await service.scan('me', session_id);

    expect(await service.scan('me', session_id)).toEqual(first);
  });

  it('hết hạn: poll báo expired, quét báo 410', async () => {
    const { service, rows } = build();
    const { session_id, secret } = await service.create({});
    expire(rows, session_id);

    expect(await service.poll(session_id, secret, {})).toEqual({ status: 'expired' });
    await expect(service.scan('me', session_id)).rejects.toBeInstanceOf(GoneException);
  });

  it('quét thì nới hạn để người quét sát giờ vẫn kịp xác nhận', async () => {
    const { service, rows } = build();
    const { session_id } = await service.create({});
    rows.get(session_id)!.expiresAt = new Date(Date.now() + 5_000);

    await service.scan('me', session_id);

    expect(rows.get(session_id)!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 50_000);
  });

  it('tài khoản không còn ACTIVE lúc nhận token thì không cấp', async () => {
    const { service, issueWebSession } = build({ me: { status: 'LOCKED' } });
    const { session_id, secret } = await service.create({});
    await service.scan('me', session_id);
    await service.decide('me', session_id, true);

    expect(await service.poll(session_id, secret, {})).toEqual({ status: 'rejected' });
    expect(issueWebSession).not.toHaveBeenCalled();
  });
});
