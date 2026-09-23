import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { EmailService } from '../common/email.service';
import { PrismaService } from '../common/prisma.module';
import { ChangePasswordDto, LoginDto, RefreshDto, RegisterDto, ResetPasswordDto, VerifyOtpDto } from './auth.dto';
import { referralCode } from '../referral/referral.domain';

const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');

export type SessionContext = {
  ipAddress?: string;
  userAgent?: string;
  deviceInfo?: string;
  deviceType?: string;
  location?: string;
  fcmToken?: string;
};

const ttlMilliseconds = (value: string, fallback: number) => {
  const match = /^(\d+)(s|m|h|d)$/.exec(value.trim());
  if (!match) return fallback;
  const amount = Number(match[1]);
  const factors = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return amount * factors[match[2] as keyof typeof factors];
};

const inferDeviceType = (context: SessionContext) => {
  if (context.deviceType) return context.deviceType;
  const agent = context.userAgent ?? '';
  if (/ipad|tablet/i.test(agent)) return 'tablet';
  if (/mobile|android|iphone/i.test(agent)) return 'mobile';
  return agent ? 'desktop' : 'unknown';
};

export function userView(user: User) {
  return {
    id: user.id,
    email: user.email,
    full_name: user.fullName,
    nickname: user.nickname ?? user.fullName,
    referral_code: user.referralCode,
    referred_by_id: user.referredById ?? '',
    phone: user.phone ?? '',
    phone_number: user.phone ?? '',
    role: user.role.toLowerCase(),
    status: user.status.toLowerCase(),
    kyc_status: user.kycVerifiedAt ? 'approved' : 'none',
    kyc_verified_at: user.kycVerifiedAt?.getTime() ?? 0,
    created_at: user.createdAt.getTime(),
    updated_at: user.updatedAt.getTime(),
    balance_vnd: user.balanceVnd.toString(),
    email_verified_at: user.emailVerifiedAt?.getTime() ?? 0,
    terms_accepted_at: user.termsAcceptedAt?.getTime() ?? 0,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
  ) {}

  private async uniqueReferralCode() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = referralCode('MD');
      if (!(await this.prisma.user.findUnique({ where: { referralCode: code }, select: { id: true } }))) return code;
    }
    throw new BadRequestException('Không thể sinh mã giới thiệu, vui lòng thử lại');
  }

  async login(dto: LoginDto, allowedRoles?: UserRole[], context: SessionContext = {}) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (user?.loginRateLimitEnabled && user.loginLockedUntil && user.loginLockedUntil > new Date()) {
      throw new HttpException({ message: 'Tài khoản tạm khóa do đăng nhập sai nhiều lần. Vui lòng thử lại sau', code: 'AUTH_ACCOUNT_LOCKED' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const passwordValid = user ? await bcrypt.compare(dto.password, user.passwordHash) : false;
    if (!user || user.status !== 'ACTIVE' || !passwordValid) {
      if (user?.status === 'ACTIVE' && user.loginRateLimitEnabled) {
        const maxAttempts = Number(process.env.LOGIN_MAX_ATTEMPTS ?? 5);
        const baseline = user.loginLockedUntil && user.loginLockedUntil <= new Date() ? 0 : user.failedLoginAttempts;
        const attempts = baseline + 1;
        const lockMinutes = Number(process.env.LOGIN_LOCK_MINUTES ?? 15);
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: attempts >= maxAttempts ? 0 : attempts,
            loginLockedUntil: attempts >= maxAttempts ? new Date(Date.now() + lockMinutes * 60_000) : null,
          },
        });
      }
      throw new UnauthorizedException({ message: 'Email hoặc mật khẩu không đúng', code: 'AUTH_INVALID_CREDENTIALS' });
    }
    if (allowedRoles && !allowedRoles.includes(user.role)) throw new UnauthorizedException({ message: 'Không phải tài khoản quản trị', code: 'AUTH_NOT_ADMIN' });
    if (user.role === UserRole.INVESTOR && !user.emailVerifiedAt) {
      throw new ForbiddenException({ message: 'Vui lòng xác thực email trước khi đăng nhập', code: 'AUTH_EMAIL_NOT_VERIFIED' });
    }
    if (user.failedLoginAttempts || user.loginLockedUntil) {
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, loginLockedUntil: null } });
    }
    return this.issueTokens(user, {
      ...context,
      deviceInfo: dto.device_info ?? context.deviceInfo,
      deviceType: dto.device_type ?? context.deviceType,
      location: dto.device_location ?? context.location,
      fcmToken: dto.fcm_token ?? context.fcmToken,
    });
  }

  async register(dto: RegisterDto) {
    if (dto.password !== dto.confirm_password) throw new BadRequestException({ message: 'Xác nhận mật khẩu không khớp', code: 'AUTH_CONFIRM_MISMATCH' });
    const email = dto.email;
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException({ message: 'Email đã tồn tại', code: 'AUTH_EMAIL_TAKEN' });
    let referredById: string | undefined;
    let systemCodeId: string | undefined;
    if (dto.ref_by?.trim()) {
      const code = dto.ref_by.trim();
      const systemCode = await this.prisma.systemReferralCode.findUnique({ where: { code: code.toUpperCase() } });
      if (systemCode) {
        if (!systemCode.isActive || systemCode.claimedById) {
          throw new BadRequestException({ message: 'Mã đầu nhánh đã hết hiệu lực hoặc đã được sử dụng', code: 'AUTH_SYSTEM_CODE_INVALID' });
        }
        systemCodeId = systemCode.id;
      } else {
        const referrer = await this.prisma.user.findFirst({ where: { referralCode: { equals: code, mode: 'insensitive' } } });
        const agency = referrer ? null : await this.prisma.agency.findUnique({ where: { code: code.toUpperCase() } });
        referredById = referrer?.id ?? agency?.userId;
        if (!referredById) throw new BadRequestException({ message: 'Mã giới thiệu không hợp lệ', code: 'AUTH_REFERRAL_INVALID' });
      }
    }
    const fullName = dto.full_name.trim();
    const generatedReferralCode = await this.uniqueReferralCode();
    let user: User;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email,
            fullName,
            nickname: dto.nickname?.trim() || fullName,
            passwordHash: await bcrypt.hash(dto.password, 12),
            referralCode: generatedReferralCode,
            referredById,
            termsAcceptedAt: new Date(),
          },
        });
        if (systemCodeId) {
          const claimed = await tx.systemReferralCode.updateMany({
            where: { id: systemCodeId, isActive: true, claimedById: null },
            data: { claimedById: created.id, claimedAt: new Date(), isActive: false },
          });
          if (claimed.count !== 1) throw new BadRequestException({ message: 'Mã đầu nhánh đã được sử dụng', code: 'AUTH_SYSTEM_CODE_TAKEN' });
        }
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ message: 'Email hoặc mã giới thiệu đã tồn tại', code: 'AUTH_REGISTER_CONFLICT' });
      }
      throw error;
    }
    let otpDelivery;
    try {
      otpDelivery = await this.requestOtp(email, 'register');
    } catch (error) {
      await this.prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
      if (systemCodeId) {
        await this.prisma.systemReferralCode.update({
          where: { id: systemCodeId },
          data: { claimedById: null, claimedAt: null, isActive: true },
        }).catch(() => undefined);
      }
      throw error;
    }
    return { user: userView(user), verification_required: true, otp: otpDelivery };
  }

  /**
   * The same response whether or not the email exists.
   *
   * Used by every public entry point that sends an OTP. Leaking the difference
   * would let anyone run a list of addresses and learn which ones are
   * registered — a map of the system's users.
   */
  private otpSilentOk() {
    const expiryMinutes = Number(process.env.OTP_TTL_MINUTES ?? 5);
    const cooldownSeconds = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS ?? 60);
    return {
      sent: true,
      delivery: 'email',
      expires_in: expiryMinutes * 60,
      resend_available_in: cooldownSeconds,
    };
  }

  async requestOtp(emailValue: string, purpose: 'register' | 'reset') {
    const email = emailValue.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    /*
      Do NOT reveal whether the email exists or is already verified — see
      `otpSilentOk`. A real user who has just registered certainly has one, so
      staying silent costs the normal flow nothing.
    */
    if (!user) return this.otpSilentOk();
    if (purpose === 'register' && user.emailVerifiedAt) return this.otpSilentOk();
    const cooldownSeconds = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS ?? 60);
    const recent = await this.prisma.verificationCode.findFirst({
      where: {
        email,
        purpose,
        consumedAt: null,
        createdAt: { gt: new Date(Date.now() - cooldownSeconds * 1000) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) {
      throw new HttpException(
        { message: `Vui lòng chờ ${cooldownSeconds} giây trước khi gửi lại OTP`, code: 'AUTH_OTP_COOLDOWN' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const otp = randomInt(100000, 1000000).toString();
    const expiryMinutes = Number(process.env.OTP_TTL_MINUTES ?? 5);
    const row = await this.prisma.verificationCode.create({
      data: { email, purpose, codeHash: hashToken(otp), expiresAt: new Date(Date.now() + expiryMinutes * 60_000) },
    });
    try {
      await this.email.sendOtp(email, otp, purpose, expiryMinutes);
    } catch (error) {
      await this.prisma.verificationCode.delete({ where: { id: row.id } }).catch(() => undefined);
      throw error;
    }
    return {
      sent: true,
      delivery: 'email',
      expires_in: expiryMinutes * 60,
      resend_available_in: cooldownSeconds,
    };
  }

  async verifyOtp(dto: VerifyOtpDto, purpose: 'register' | 'reset') {
    await this.consumeOtp(dto, purpose);
    if (purpose === 'register') {
      await this.prisma.user.update({ where: { email: dto.email }, data: { emailVerifiedAt: new Date() } });
    }
    return { verified: true, email: dto.email };
  }

  async requestPasswordReset(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    /* A non-ACTIVE account stays silent too — see `otpSilentOk`. */
    if (!user || user.status !== 'ACTIVE') return this.otpSilentOk();
    return this.requestOtp(email, 'reset');
  }

  async verifyPasswordResetOtp(dto: VerifyOtpDto) {
    await this.consumeOtp(dto, 'reset');
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || user.status !== 'ACTIVE') throw new BadRequestException({ message: 'OTP không hợp lệ hoặc đã hết hạn', code: 'AUTH_OTP_INVALID' });

    const resetToken = randomBytes(32).toString('base64url');
    const ttlMinutes = Math.max(1, Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES ?? 10));
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
    await this.prisma.$transaction([
      this.prisma.passwordResetTicket.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetTicket.create({
        data: { userId: user.id, tokenHash: hashToken(resetToken), expiresAt },
      }),
    ]);
    return { verified: true, reset_token: resetToken, expires_in: ttlMinutes * 60 };
  }

  private async consumeOtp(dto: VerifyOtpDto, purpose: 'register' | 'reset') {
    const row = await this.prisma.verificationCode.findFirst({
      where: { email: dto.email, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) throw new BadRequestException({ message: 'OTP không hợp lệ hoặc đã hết hạn', code: 'AUTH_OTP_INVALID' });
    if (row.codeHash !== hashToken(dto.otp)) {
      const attempts = row.attempts + 1;
      await this.prisma.verificationCode.update({
        where: { id: row.id },
        data: { attempts, consumedAt: attempts >= Number(process.env.OTP_MAX_ATTEMPTS ?? 5) ? new Date() : undefined },
      });
      throw new BadRequestException({ message: 'OTP không hợp lệ hoặc đã hết hạn', code: 'AUTH_OTP_INVALID' });
    }
    await this.prisma.verificationCode.updateMany({
      where: { email: dto.email, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  }

  async resetPassword(dto: ResetPasswordDto) {
    if (dto.new_password !== dto.confirm_password) throw new BadRequestException({ message: 'Xác nhận mật khẩu không khớp', code: 'AUTH_CONFIRM_MISMATCH' });
    const ticket = await this.prisma.passwordResetTicket.findUnique({
      where: { tokenHash: hashToken(dto.reset_token) },
    });
    if (!ticket || ticket.usedAt || ticket.expiresAt <= new Date()) {
      throw new BadRequestException({ message: 'Phiên đặt lại mật khẩu không hợp lệ hoặc đã hết hạn', code: 'AUTH_RESET_TICKET_INVALID' });
    }

    const now = new Date();
    const passwordHash = await bcrypt.hash(dto.new_password, 12);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetTicket.updateMany({
        where: { id: ticket.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw new BadRequestException({ message: 'Phiên đặt lại mật khẩu không hợp lệ hoặc đã hết hạn', code: 'AUTH_RESET_TICKET_INVALID' });
      await tx.user.update({ where: { id: ticket.userId }, data: { passwordHash } });
      await tx.refreshToken.updateMany({ where: { userId: ticket.userId, revokedAt: null }, data: { revokedAt: now } });
    });
    return { reset: true };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    if (dto.new_password !== dto.confirm_password) {
      throw new BadRequestException({ message: 'Xác nhận mật khẩu không khớp', code: 'AUTH_CONFIRM_MISMATCH' });
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(dto.old_password, user.passwordHash))) {
      throw new BadRequestException({ message: 'Mật khẩu hiện tại không đúng', code: 'AUTH_CURRENT_PASSWORD_WRONG' });
    }
    if (dto.new_password === dto.old_password) {
      throw new BadRequestException({ message: 'Mật khẩu mới phải khác mật khẩu hiện tại', code: 'AUTH_PASSWORD_UNCHANGED' });
    }
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(dto.new_password, 12) } });
    return { changed: true };
  }

  async refresh(dto: RefreshDto, context: SessionContext = {}) {
    let payload: { sub: string; role: UserRole; sid?: string };
    try {
      payload = await this.jwt.verifyAsync(dto.refresh_token, { secret: process.env.JWT_REFRESH_SECRET });
    } catch {
      throw new UnauthorizedException({ message: 'Refresh token không hợp lệ', code: 'AUTH_REFRESH_INVALID' });
    }
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(dto.refresh_token) } });
    if (!stored || stored.revokedAt || stored.expiresAt <= new Date()) throw new UnauthorizedException({ message: 'Refresh token đã hết hiệu lực', code: 'AUTH_REFRESH_REVOKED' });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: payload.sub } });
    if (user.status !== 'ACTIVE' || (user.role === UserRole.INVESTOR && !user.emailVerifiedAt)) {
      throw new UnauthorizedException({ message: 'Tài khoản không còn hiệu lực', code: 'AUTH_ACCOUNT_INACTIVE' });
    }
    return this.issueTokens(user, context, stored.id);
  }

  async logout(userId: string, sessionId?: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null, ...(sessionId ? { id: sessionId } : {}) },
      data: { revokedAt: new Date() },
    });
    return { logged_out: true };
  }

  private async issueTokens(user: User, context: SessionContext = {}, existingSessionId?: string) {
    const sessionId = existingSessionId ?? randomUUID();
    const payload = { sub: user.id, id: user.id, role: user.role, sid: sessionId, jti: randomBytes(16).toString('hex') };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: (process.env.JWT_ACCESS_TTL ?? '15m') as never,
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: (process.env.JWT_REFRESH_TTL ?? '30d') as never,
    });
    const expiresAt = new Date(Date.now() + ttlMilliseconds(process.env.JWT_REFRESH_TTL ?? '30d', 30 * 86_400_000));
    const priorSession = !existingSessionId && user.suspiciousLoginAlerts
      ? await this.prisma.refreshToken.findFirst({ where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } } })
      : null;
    await this.prisma.refreshToken.upsert({
      where: { id: sessionId },
      create: {
        id: sessionId,
        tokenHash: hashToken(refreshToken),
        userId: user.id,
        deviceInfo: context.deviceInfo ?? context.userAgent?.slice(0, 120),
        deviceType: inferDeviceType(context),
        location: context.location,
        fcmToken: context.fcmToken,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent?.slice(0, 500),
        expiresAt,
      },
      update: {
        tokenHash: hashToken(refreshToken),
        deviceInfo: context.deviceInfo,
        deviceType: context.deviceType,
        location: context.location,
        fcmToken: context.fcmToken,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent?.slice(0, 500),
        expiresAt,
        lastUsedAt: new Date(),
        revokedAt: null,
      },
    });
    if (priorSession && (
      priorSession.ipAddress !== (context.ipAddress ?? null)
      || priorSession.deviceInfo !== (context.deviceInfo ?? context.userAgent?.slice(0, 120) ?? null)
    )) {
      void this.email.sendLoginAlert(user.email, context.deviceInfo ?? inferDeviceType(context), context.ipAddress, context.location)
        .catch(() => undefined);
    }
    return { user: userView(user), access_token: accessToken, refresh_token: refreshToken, session_id: sessionId };
  }
}
