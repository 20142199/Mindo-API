import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma, ReferralCommissionType } from '@prisma/client';
import { PrismaService } from '../common/prisma.module';
import { CreateSystemReferralCodeDto, UpdateReferralSettingsDto } from './referral.dto';
import { percentToRate, rateToPercent, referralCode } from './referral.domain';

const SETTINGS_ID = 'default';

@Injectable()
export class ReferralService {
  constructor(private readonly prisma: PrismaService) {}

  private settings(client: Prisma.TransactionClient | PrismaService = this.prisma) {
    return client.referralSetting.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, directRate: '0.10', branchRate: '0.05' },
      update: {},
    });
  }

  async getSettings() {
    const settings = await this.settings();
    return {
      direct_rate_percent: rateToPercent(settings.directRate),
      branch_rate_percent: rateToPercent(settings.branchRate),
      updated_at: settings.updatedAt,
    };
  }

  async updateSettings(actorId: string, dto: UpdateReferralSettingsDto) {
    const settings = await this.prisma.referralSetting.upsert({
      where: { id: SETTINGS_ID },
      create: {
        id: SETTINGS_ID,
        directRate: new Prisma.Decimal(percentToRate(dto.direct_rate_percent)),
        branchRate: new Prisma.Decimal(percentToRate(dto.branch_rate_percent)),
        updatedById: actorId,
      },
      update: {
        directRate: new Prisma.Decimal(percentToRate(dto.direct_rate_percent)),
        branchRate: new Prisma.Decimal(percentToRate(dto.branch_rate_percent)),
        updatedById: actorId,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'REFERRAL_SETTINGS_UPDATED',
        entityType: 'ReferralSetting',
        entityId: settings.id,
        metadata: { directRatePercent: dto.direct_rate_percent, branchRatePercent: dto.branch_rate_percent },
      },
    });
    return this.getSettings();
  }

  private async uniqueCode(prefix: 'MD' | 'SYS') {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = referralCode(prefix);
      const exists = prefix === 'SYS'
        ? await this.prisma.systemReferralCode.findUnique({ where: { code }, select: { id: true } })
        : await this.prisma.user.findUnique({ where: { referralCode: code }, select: { id: true } });
      if (!exists) return code;
    }
    throw new BadRequestException('Không thể sinh mã giới thiệu, vui lòng thử lại');
  }

  async createSystemCode(actorId: string, dto: CreateSystemReferralCodeDto) {
    const code = await this.uniqueCode('SYS');
    const created = await this.prisma.systemReferralCode.create({
      data: { code, label: dto.label?.trim() || null, createdById: actorId },
      include: { claimedBy: { select: { id: true, fullName: true, email: true, referralCode: true } } },
    });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'SYSTEM_REFERRAL_CODE_CREATED', entityType: 'SystemReferralCode', entityId: created.id, metadata: { code } },
    });
    return created;
  }

  async setSystemCodeActive(actorId: string, id: string, isActive: boolean) {
    const code = await this.prisma.systemReferralCode.findUnique({ where: { id } });
    if (!code) throw new NotFoundException('Không tìm thấy mã hệ thống');
    if (code.claimedById && isActive) throw new BadRequestException('Mã đã được sử dụng và không thể kích hoạt lại');
    const updated = await this.prisma.systemReferralCode.update({ where: { id }, data: { isActive } });
    await this.prisma.auditLog.create({
      data: { actorId, action: isActive ? 'SYSTEM_REFERRAL_CODE_ENABLED' : 'SYSTEM_REFERRAL_CODE_DISABLED', entityType: 'SystemReferralCode', entityId: id },
    });
    return updated;
  }

  private async descendantIds(rootId: string) {
    const found: string[] = [];
    let parents = [rootId];
    for (let depth = 0; depth < 50 && parents.length; depth += 1) {
      const children = await this.prisma.user.findMany({
        where: { referredById: { in: parents } },
        select: { id: true },
      });
      const next = children.map((child) => child.id).filter((id) => !found.includes(id));
      found.push(...next);
      parents = next;
    }
    return found;
  }

  private async branchMetrics(rootId?: string | null) {
    if (!rootId) return { downline_count: 0, downline_sales_vnd: '0', branch_commission_vnd: '0' };
    const descendants = await this.descendantIds(rootId);
    const [sales, commission] = await Promise.all([
      descendants.length
        ? this.prisma.purchaseOrder.aggregate({ where: { userId: { in: descendants }, status: OrderStatus.COMPLETED }, _sum: { totalVnd: true } })
        : Promise.resolve({ _sum: { totalVnd: null } }),
      this.prisma.referralCommission.aggregate({ where: { beneficiaryId: rootId, type: ReferralCommissionType.BRANCH }, _sum: { amountVnd: true } }),
    ]);
    return {
      downline_count: descendants.length,
      downline_sales_vnd: sales._sum.totalVnd?.toString() ?? '0',
      branch_commission_vnd: commission._sum.amountVnd?.toString() ?? '0',
    };
  }

  async listSystemCodes() {
    const codes = await this.prisma.systemReferralCode.findMany({
      include: {
        claimedBy: { select: { id: true, fullName: true, email: true, referralCode: true, createdAt: true } },
        createdBy: { select: { fullName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(codes.map(async (code) => ({ ...code, ...(await this.branchMetrics(code.claimedById)) })));
  }

  private async findBranchRoot(client: Prisma.TransactionClient, referredById?: string | null) {
    let currentId = referredById;
    const visited = new Set<string>();
    for (let depth = 0; currentId && depth < 50 && !visited.has(currentId); depth += 1) {
      visited.add(currentId);
      const current = await client.user.findUnique({
        where: { id: currentId },
        select: { id: true, referredById: true, claimedSystemReferralCode: { select: { id: true } } },
      });
      if (!current) return null;
      if (current.claimedSystemReferralCode) return current.id;
      currentId = current.referredById;
    }
    return null;
  }

  async applyPurchaseCommissions(
    client: Prisma.TransactionClient,
    order: { id: string; totalVnd: Prisma.Decimal },
    buyer: { id: string; referredById: string | null },
  ) {
    const settings = await this.settings(client);
    const awards: Array<{ beneficiaryId: string; type: ReferralCommissionType; rate: Prisma.Decimal }> = [];
    if (buyer.referredById && buyer.referredById !== buyer.id) {
      awards.push({ beneficiaryId: buyer.referredById, type: ReferralCommissionType.DIRECT, rate: settings.directRate });
    }
    const branchRootId = await this.findBranchRoot(client, buyer.referredById);
    if (branchRootId && branchRootId !== buyer.id) {
      awards.push({ beneficiaryId: branchRootId, type: ReferralCommissionType.BRANCH, rate: settings.branchRate });
    }
    for (const award of awards) {
      const amountVnd = order.totalVnd.mul(award.rate).toDecimalPlaces(0);
      if (amountVnd.lessThanOrEqualTo(0)) continue;
      const commission = await client.referralCommission.create({
        data: {
          orderId: order.id,
          beneficiaryId: award.beneficiaryId,
          buyerId: buyer.id,
          type: award.type,
          rate: award.rate,
          amountVnd,
        },
      });
      await client.user.update({ where: { id: award.beneficiaryId }, data: { balanceVnd: { increment: amountVnd } } });
      await client.ledgerEntry.create({
        data: {
          userId: award.beneficiaryId,
          amountVnd,
          direction: 'CREDIT',
          description: award.type === ReferralCommissionType.DIRECT
            ? `Thưởng giới thiệu trực tiếp đơn ${order.id}`
            : `Thưởng doanh số đầu nhánh đơn ${order.id}`,
          referralCommissionId: commission.id,
        },
      });
    }
    return awards.length;
  }

  async dashboard(userId: string) {
    const [user, settings, directCommission, recent] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          referralCode: true,
          referredBy: { select: { id: true, fullName: true, referralCode: true } },
          claimedSystemReferralCode: { select: { code: true, label: true, claimedAt: true } },
          _count: { select: { referrals: true } },
        },
      }),
      this.getSettings(),
      this.prisma.referralCommission.aggregate({ where: { beneficiaryId: userId, type: ReferralCommissionType.DIRECT }, _sum: { amountVnd: true } }),
      this.prisma.referralCommission.findMany({
        where: { beneficiaryId: userId },
        include: {
          buyer: { select: { id: true, fullName: true, email: true } },
          order: { select: { id: true, totalVnd: true, createdAt: true, product: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    const branch = await this.branchMetrics(user.claimedSystemReferralCode ? user.id : null);
    return {
      referral_code: user.referralCode,
      referred_by: user.referredBy,
      is_branch_root: Boolean(user.claimedSystemReferralCode),
      system_code: user.claimedSystemReferralCode,
      direct_referrals: user._count.referrals,
      direct_commission_vnd: directCommission._sum.amountVnd?.toString() ?? '0',
      ...branch,
      total_commission_vnd: new Prisma.Decimal(directCommission._sum.amountVnd ?? 0).add(branch.branch_commission_vnd).toString(),
      settings,
      recent_commissions: recent,
    };
  }
}

