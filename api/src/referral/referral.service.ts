import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma, ReferralCommissionType } from '@prisma/client';
import { PrismaService } from '../common/prisma.module';
import { CreateSystemReferralCodeDto, ReferralCommissionQueryDto, ReferralPeriodQueryDto, UpdateReferralSettingsDto } from './referral.dto';
import { percentToRate, rateToPercent, referralCode } from './referral.domain';
import { pageExtra } from '../common/api-response';

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
    purchaseReferrerId?: string | null,
  ) {
    const settings = await this.settings(client);
    const awards: Array<{ beneficiaryId: string; type: ReferralCommissionType; rate: Prisma.Decimal }> = [];
    const directReferrerId = purchaseReferrerId ?? buyer.referredById;
    if (directReferrerId && directReferrerId !== buyer.id) {
      awards.push({ beneficiaryId: directReferrerId, type: ReferralCommissionType.DIRECT, rate: settings.directRate });
    }
    const branchRootId = await this.findBranchRoot(client, directReferrerId);
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

  async commissions(userId: string, query: ReferralCommissionQueryDto) {
    const createdAt = this.period(query.from, query.to);
    const where: Prisma.ReferralCommissionWhereInput = {
      beneficiaryId: userId,
      ...(query.type ? { type: query.type } : {}),
      ...(createdAt ? { createdAt } : {}),
    };
    const [total, rows, sum, exchange] = await Promise.all([
      this.prisma.referralCommission.count({ where }),
      this.prisma.referralCommission.findMany({
        where,
        include: {
          buyer: { select: { id: true, fullName: true, email: true, referralCode: true } },
          order: { include: { product: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.referralCommission.aggregate({ where, _sum: { amountVnd: true } }),
      this.prisma.agencyPackageSetting.findUnique({ where: { id: 'default' } }),
    ]);
    const usdVndRate = exchange?.usdVndRate ?? new Prisma.Decimal(25_000);
    const totalVnd = sum._sum.amountVnd ?? new Prisma.Decimal(0);
    return {
      data: {
        summary: {
          total_commission_vnd: totalVnd.toString(),
          total_commission_usd: totalVnd.div(usdVndRate).toFixed(2),
          usd_vnd_rate: usdVndRate.toString(),
          transaction_count: total,
        },
        items: rows.map((row) => this.commissionView(row, usdVndRate)),
        applied_filters: { from: query.from ?? null, to: query.to ?? null, type: query.type ?? null },
      },
      extra: pageExtra(query.page, query.limit, total),
    };
  }

  async commissionDetail(userId: string, id: string) {
    const [row, exchange] = await Promise.all([
      this.prisma.referralCommission.findFirst({
        where: { id, beneficiaryId: userId },
        include: {
          buyer: { select: { id: true, fullName: true, email: true, referralCode: true } },
          order: { include: { product: true } },
        },
      }),
      this.prisma.agencyPackageSetting.findUnique({ where: { id: 'default' } }),
    ]);
    if (!row) throw new NotFoundException('Không tìm thấy giao dịch hoa hồng');
    return this.commissionView(row, exchange?.usdVndRate ?? new Prisma.Decimal(25_000));
  }

  async branchSales(userId: string, query: ReferralPeriodQueryDto) {
    const root = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { claimedSystemReferralCode: { select: { code: true, label: true, claimedAt: true } } },
    });
    if (!root.claimedSystemReferralCode) throw new ForbiddenException('Chỉ tài khoản nhận mã ref tổng mới được xem doanh số đầu nhánh');
    const descendants = await this.descendantIds(userId);
    const createdAt = this.period(query.from, query.to);
    const orderWhere: Prisma.PurchaseOrderWhereInput = {
      userId: { in: descendants },
      status: OrderStatus.COMPLETED,
      ...(createdAt ? { createdAt } : {}),
    };
    const commissionWhere: Prisma.ReferralCommissionWhereInput = {
      beneficiaryId: userId,
      type: ReferralCommissionType.BRANCH,
      ...(createdAt ? { createdAt } : {}),
    };
    const [total, rows, sales, rewards, exchange] = await Promise.all([
      descendants.length ? this.prisma.purchaseOrder.count({ where: orderWhere }) : Promise.resolve(0),
      descendants.length ? this.prisma.purchaseOrder.findMany({
        where: orderWhere,
        include: { user: { select: { id: true, fullName: true, email: true } }, product: true },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }) : Promise.resolve([]),
      descendants.length ? this.prisma.purchaseOrder.aggregate({ where: orderWhere, _sum: { totalVnd: true, quantity: true } }) : Promise.resolve({ _sum: { totalVnd: null, quantity: null } }),
      this.prisma.referralCommission.aggregate({ where: commissionWhere, _sum: { amountVnd: true } }),
      this.prisma.agencyPackageSetting.findUnique({ where: { id: 'default' } }),
    ]);
    const usdVndRate = exchange?.usdVndRate ?? new Prisma.Decimal(25_000);
    const totalSalesVnd = sales._sum.totalVnd ?? new Prisma.Decimal(0);
    const rewardVnd = rewards._sum.amountVnd ?? new Prisma.Decimal(0);
    return {
      data: {
        system_code: root.claimedSystemReferralCode,
        period: { from: query.from ?? null, to: query.to ?? null },
        metrics: {
          downline_count: descendants.length,
          order_count: total,
          total_peer: sales._sum.quantity ?? 0,
          total_sales_vnd: totalSalesVnd.toString(),
          total_sales_usd: totalSalesVnd.div(usdVndRate).toFixed(2),
          branch_reward_vnd: rewardVnd.toString(),
          branch_reward_usd: rewardVnd.div(usdVndRate).toFixed(2),
          usd_vnd_rate: usdVndRate.toString(),
        },
        orders: rows.map((row) => ({
          id: row.id,
          transaction_code: `TX#${row.id.slice(-8).toUpperCase()}`,
          buyer: { id: row.user.id, full_name: row.user.fullName, email: row.user.email },
          product: { id: row.product.id, name: row.product.name, symbol: row.product.symbol },
          quantity: row.quantity,
          amount_vnd: row.totalVnd.toString(),
          amount_usd: row.totalVnd.div(usdVndRate).toFixed(2),
          occurred_at: row.createdAt.toISOString(),
        })),
      },
      extra: pageExtra(query.page, query.limit, total),
    };
  }

  private commissionView(row: {
    id: string;
    type: ReferralCommissionType;
    rate: Prisma.Decimal;
    amountVnd: Prisma.Decimal;
    createdAt: Date;
    buyer: { id: string; fullName: string; email: string; referralCode: string };
    order: {
      id: string;
      quantity: number;
      unitPriceVnd: Prisma.Decimal;
      totalVnd: Prisma.Decimal;
      grossTotalVnd: Prisma.Decimal | null;
      discountVnd: Prisma.Decimal | null;
      effectiveDiscountRate: Prisma.Decimal | null;
      agencyTitle: string | null;
      product: { id: string; name: string; symbol: string };
    };
  }, usdVndRate: Prisma.Decimal) {
    return {
      id: row.id,
      type: row.type.toLowerCase(),
      rate_percent: row.rate.mul(100).toString(),
      amount_vnd: row.amountVnd.toString(),
      amount_usd: row.amountVnd.div(usdVndRate).toFixed(2),
      usd_vnd_rate: usdVndRate.toString(),
      status: 'credited',
      buyer: { id: row.buyer.id, full_name: row.buyer.fullName, email: row.buyer.email, referral_code: row.buyer.referralCode },
      order: {
        id: row.order.id,
        transaction_code: `TX#${row.order.id.slice(-8).toUpperCase()}`,
        product: { id: row.order.product.id, name: row.order.product.name, symbol: row.order.product.symbol },
        quantity: row.order.quantity,
        gross_amount_vnd: row.order.grossTotalVnd?.toString() ?? row.order.totalVnd.toString(),
        discount_vnd: row.order.discountVnd?.toString() ?? '0',
        net_amount_vnd: row.order.totalVnd.toString(),
        discount_percent: row.order.effectiveDiscountRate?.mul(100).toString() ?? '0',
        agency_title: row.order.agencyTitle,
      },
      calculation: `${row.order.totalVnd.toString()} × ${row.rate.mul(100).toString()}%`,
      credited_at: row.createdAt.toISOString(),
    };
  }

  private period(from?: string, to?: string) {
    if (!from && !to) return undefined;
    const start = from ? new Date(from) : undefined;
    const end = to ? new Date(to.length === 10 ? `${to}T23:59:59.999Z` : to) : undefined;
    if (start && end && start > end) throw new BadRequestException('Khoảng thời gian không hợp lệ');
    return { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
  }
}
