import { ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { UserStatus, WebLoginStatus } from '@prisma/client';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { PrismaService } from '../common/prisma.module';
import { AuthService } from './auth.service';
import { describeBrowser } from './web-login.browser';

/** Mã sống 60 giây; quét thì cho thêm 60 giây nữa để kịp bấm xác nhận. */
const QR_TTL_MS = 60_000;
const DAY_MS = 86_400_000;

const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');

const sameHash = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

type WebContext = { userAgent?: string; ipAddress?: string; deviceInfo?: string };

const notFound = () =>
  new NotFoundException({ message: 'Không tìm thấy mã đăng nhập', code: 'QR_NOT_FOUND' });

const expired = () =>
  new GoneException({ message: 'Mã đăng nhập đã hết hạn', code: 'QR_EXPIRED' });

/**
 * Đăng nhập web bằng mã QR quét từ app — xem docs/web-qr-login-design.md.
 *
 * Hai điều giữ cho tính năng này an toàn, và cả hai nằm ở đây:
 *
 * 1. QR chỉ mang `id`. Muốn đổi yêu cầu đã duyệt lấy token phải có thêm KHOÁ,
 *    thứ chỉ trình duyệt đã tạo mã giữ (trong cookie httpOnly bên BFF). Ai chụp
 *    lén QR cũng không cướp được phiên.
 * 2. Mỗi bước chuyển trạng thái là một câu `UPDATE … WHERE status = <cũ>`. Hai
 *    lần poll hay hai máy quét cùng lúc thì chỉ một bên đổi được hàng — không
 *    bao giờ cấp hai phiên từ một mã.
 */
@Injectable()
export class WebLoginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async create(context: WebContext) {
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + QR_TTL_MS);
    await this.prisma.webLoginRequest.create({
      data: {
        id,
        secretHash: hashSecret(secret),
        browser: describeBrowser(context.deviceInfo ?? context.userAgent),
        ipAddress: context.ipAddress,
        expiresAt,
      },
    });
    /* Dọn yêu cầu cũ hơn một ngày — rẻ, và không cần tiến trình riêng */
    void this.prisma.webLoginRequest
      .deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - DAY_MS) } } })
      .catch(() => undefined);
    return {
      session_id: id,
      secret,
      qr_value: `mindo://web-login?session=${id}`,
      expires_at: expiresAt.toISOString(),
    };
  }

  async poll(id: string, secret: string, context: WebContext) {
    const row = await this.prisma.webLoginRequest.findUnique({ where: { id } });
    /* Sai khoá trả y như không tồn tại: không để lộ rằng id có thật */
    if (!row || !sameHash(row.secretHash, hashSecret(secret))) throw notFound();
    if (row.status === WebLoginStatus.REJECTED) return { status: 'rejected' as const };
    if (row.status === WebLoginStatus.CONSUMED) return { status: 'expired' as const };

    if (row.status === WebLoginStatus.APPROVED) {
      /* Đổi sang CONSUMED TRƯỚC, cấp token SAU: hai lần poll cùng lúc thì chỉ
         một bên đổi được hàng. Cấp trước rồi mới đánh dấu là hở một khe cho
         hai phiên ra đời từ cùng một mã. */
      const claimed = await this.prisma.webLoginRequest.updateMany({
        where: { id, status: WebLoginStatus.APPROVED, expiresAt: { gt: new Date() } },
        data: { status: WebLoginStatus.CONSUMED },
      });
      if (claimed.count !== 1 || !row.userId) return { status: 'expired' as const };
      const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
      /* Bị khoá giữa lúc bấm duyệt và lúc web tới nhận thì không cấp */
      if (!user || user.status !== UserStatus.ACTIVE) return { status: 'rejected' as const };
      const tokens = await this.auth.issueWebSession(user, {
        deviceInfo: row.browser ?? undefined,
        deviceType: 'desktop',
        userAgent: context.userAgent,
        ipAddress: row.ipAddress ?? undefined,
      });
      return { status: 'approved' as const, ...tokens };
    }

    if (row.expiresAt <= new Date()) return { status: 'expired' as const };
    return row.status === WebLoginStatus.SCANNED
      ? { status: 'scanned' as const }
      : { status: 'pending' as const };
  }

  async scan(userId: string, id: string) {
    const now = new Date();
    const claimed = await this.prisma.webLoginRequest.updateMany({
      where: { id, status: WebLoginStatus.PENDING, expiresAt: { gt: now } },
      data: {
        status: WebLoginStatus.SCANNED,
        userId,
        scannedAt: now,
        expiresAt: new Date(now.getTime() + QR_TTL_MS),
      },
    });
    const row = await this.prisma.webLoginRequest.findUnique({ where: { id } });
    if (!row) throw notFound();

    if (claimed.count === 0) {
      /* Cùng người quét lại (camera bắt mã hai lần, mở lại màn) thì trả lại y
         như lần đầu thay vì báo lỗi */
      const sameScanner =
        row.status === WebLoginStatus.SCANNED && row.userId === userId && row.expiresAt > now;
      if (!sameScanner) {
        if (row.userId && row.userId !== userId) {
          throw new ConflictException({
            message: 'Mã này đã được quét bằng tài khoản khác',
            code: 'QR_ALREADY_SCANNED',
          });
        }
        throw expired();
      }
    }

    return { browser: row.browser, ip_address: row.ipAddress, created_at: row.createdAt.toISOString() };
  }

  async decide(userId: string, id: string, approve: boolean) {
    const now = new Date();
    const changed = await this.prisma.webLoginRequest.updateMany({
      /* `userId` nằm trong điều kiện: chỉ đúng người đã quét mới quyết định được */
      where: { id, userId, status: WebLoginStatus.SCANNED, expiresAt: { gt: now } },
      data: {
        status: approve ? WebLoginStatus.APPROVED : WebLoginStatus.REJECTED,
        decidedAt: now,
      },
    });
    if (changed.count !== 1) throw expired();
    return { status: approve ? ('approved' as const) : ('rejected' as const) };
  }
}
