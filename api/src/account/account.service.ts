import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RefreshToken } from '@prisma/client';
import { normalizePhone } from '../common/identity.util';
import { PrismaService } from '../common/prisma.module';
import { FileStorageService } from '../phase1/file-storage.service';
import { UpdateAccountSettingsDto, UpdateProfileDto } from './account.dto';

const maskIp = (value: string | null) => {
  if (!value) return null;
  if (value.includes(':')) {
    const groups = value.split(':').filter(Boolean);
    return groups.length > 2 ? `${groups.slice(0, 2).join(':')}:xxxx:xxxx` : value;
  }
  const parts = value.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.xxx.xxx` : value;
};

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService, private readonly files: FileStorageService) {}

  async getAccount(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        agency: { select: { status: true } },
        kycSubmissions: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    const avatar = user.avatarFileId
      ? await this.prisma.fileUpload.findUnique({ where: { id: user.avatarFileId } })
      : null;
    const kyc = user.kycSubmissions[0];
    return {
      uid: user.id,
      email: user.email,
      full_name: user.fullName,
      phone_number: user.phone ?? '',
      address: user.address ?? '',
      avatar_file_id: avatar?.id ?? null,
      avatar: avatar?.ownerId === userId ? this.files.view(avatar) : null,
      account_type: user.agency?.status === 'APPROVED' ? 'business' : 'personal',
      bank_account: {
        account_name: user.bankAccountName ?? '',
        account_number: user.bankAccountNumber ?? '',
        bank_name: user.bankName ?? '',
      },
      kyc: {
        status: kyc?.status.toLowerCase() ?? 'none',
        rejection_reason: kyc?.rejectionReason ?? null,
        submitted_at: kyc?.createdAt.getTime() ?? null,
        reviewed_at: kyc?.reviewedAt?.getTime() ?? null,
      },
      onboarding: {
        profile_completed: Boolean(user.phone && user.address),
        kyc_completed: Boolean(user.kycVerifiedAt),
      },
      created_at: user.createdAt.getTime(),
      updated_at: user.updatedAt.getTime(),
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    if (dto.avatar_file_id) {
      const avatar = await this.files.assertOwned(userId, dto.avatar_file_id);
      if (!avatar.mimeType.startsWith('image/')) throw new BadRequestException('Avatar phải là file ảnh');
    }
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          fullName: dto.full_name,
          nickname: dto.full_name,
          phone: dto.phone_number,
          phoneNormalized: dto.phone_number === undefined ? undefined : normalizePhone(dto.phone_number),
          address: dto.address,
          avatarFileId: dto.avatar_file_id,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Số điện thoại đã được sử dụng bởi tài khoản khác');
      }
      throw error;
    }
    return this.getAccount(userId);
  }

  async getSettings(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return {
      language: user.language,
      suspicious_login_alerts: user.suspiciousLoginAlerts,
      login_rate_limit_enabled: user.loginRateLimitEnabled,
      in_app_notifications: user.inAppNotifications,
      email_notifications: user.emailNotifications,
      support_center_url: process.env.SUPPORT_CENTER_URL || null,
    };
  }

  async updateSettings(userId: string, dto: UpdateAccountSettingsDto) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        language: dto.language,
        suspiciousLoginAlerts: dto.suspicious_login_alerts,
        loginRateLimitEnabled: dto.login_rate_limit_enabled,
        inAppNotifications: dto.in_app_notifications,
        emailNotifications: dto.email_notifications,
      },
    });
    return this.getSettings(userId);
  }

  async sessions(userId: string, currentSessionId?: string) {
    const rows = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return rows.map((row) => this.sessionView(row, currentSessionId));
  }

  async revokeSession(userId: string, sessionId: string) {
    const result = await this.prisma.refreshToken.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count !== 1) throw new NotFoundException('Phiên đăng nhập không tồn tại');
    return { logged_out: true, session_id: sessionId };
  }

  async revokeAllSessions(userId: string) {
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { logged_out: true, revoked_sessions: result.count };
  }

  private sessionView(row: RefreshToken, currentSessionId?: string) {
    return {
      id: row.id,
      device_name: row.deviceInfo ?? 'Thiết bị không xác định',
      device_type: row.deviceType ?? 'unknown',
      ip_address: maskIp(row.ipAddress),
      location: row.location,
      is_current: row.id === currentSessionId,
      last_used_at: row.lastUsedAt.getTime(),
      created_at: row.createdAt.getTime(),
    };
  }
}
