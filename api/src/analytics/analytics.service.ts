import { Injectable } from '@nestjs/common';
import { CommissionStatus, DepositStatus, OrderStatus, ReferralCommissionType, ReviewStatus, UserRole, WithdrawalStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.module';
import { analyticsBucketKey, percentageChange, resolveAnalyticsPeriod, type AnalyticsGranularity } from './analytics.domain';

type MoneyRow = { amountVnd: unknown };
type AnalyticsSlice = {
  deposits: Array<{ paidAt: Date | null; paidAmountVnd: unknown; amountVnd: unknown }>;
  withdrawals: Array<{ reviewedAt: Date | null; amountVnd: unknown }>;
  orders: Array<{ id: string; userId: string; quantity: number; totalVnd: unknown; grossTotalVnd: unknown; discountVnd: unknown; status: OrderStatus; createdAt: Date; agencyTitle: string | null; agency: { id: string; code: string; businessName: string; user: { fullName: string } } | null }>;
  users: Array<{ createdAt: Date }>;
  kycs: Array<{ reviewedAt: Date | null }>;
  referralCommissions: Array<{ type: ReferralCommissionType; amountVnd: unknown; status: CommissionStatus; createdAt: Date }>;
  agencyCommissions: Array<{ amountVnd: unknown; status: CommissionStatus; createdAt: Date }>;
};

function money(value: unknown) { return Number(value ?? 0); }
function sum(rows: MoneyRow[]) { return rows.reduce((total, row) => total + money(row.amountVnd), 0); }
function inRange(date: Date | null, start: Date, end: Date) { return Boolean(date && date >= start && date < end); }

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async report(from?: string, to?: string, granularity?: string) {
    const period = resolveAnalyticsPeriod(from, to, granularity);
    const range = { gte: period.previousStart, lt: period.endExclusive };
    const now = new Date();
    const [deposits, withdrawals, orders, users, kycs, referralCommissions, agencyCommissions, totalInvestors, staleDeposits, staleWithdrawals, expiredDeposits] = await Promise.all([
      this.prisma.deposit.findMany({ where: { status: DepositStatus.CONFIRMED, paidAt: range }, select: { paidAt: true, paidAmountVnd: true, amountVnd: true } }),
      this.prisma.withdrawal.findMany({ where: { status: WithdrawalStatus.APPROVED, reviewedAt: range }, select: { reviewedAt: true, amountVnd: true } }),
      this.prisma.purchaseOrder.findMany({
        where: { status: { in: [OrderStatus.COMPLETED, OrderStatus.FAILED] }, createdAt: range },
        select: { id: true, userId: true, quantity: true, totalVnd: true, grossTotalVnd: true, discountVnd: true, status: true, createdAt: true, agencyTitle: true, agency: { select: { id: true, code: true, businessName: true, user: { select: { fullName: true } } } } },
      }),
      this.prisma.user.findMany({ where: { role: UserRole.INVESTOR, createdAt: range }, select: { createdAt: true } }),
      this.prisma.kycSubmission.findMany({ where: { status: ReviewStatus.APPROVED, reviewedAt: range }, select: { reviewedAt: true } }),
      this.prisma.referralCommission.findMany({ where: { status: { not: CommissionStatus.CANCELLED }, createdAt: range }, select: { type: true, amountVnd: true, status: true, createdAt: true } }),
      this.prisma.agencyCommission.findMany({ where: { status: { not: CommissionStatus.CANCELLED }, createdAt: range }, select: { amountVnd: true, status: true, createdAt: true } }),
      this.prisma.user.count({ where: { role: UserRole.INVESTOR } }),
      this.prisma.deposit.findMany({ where: { status: DepositStatus.PENDING, createdAt: { lt: new Date(now.getTime() - 30 * 60 * 1000) } }, select: { amountVnd: true } }),
      this.prisma.withdrawal.findMany({ where: { status: WithdrawalStatus.PENDING, createdAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } }, select: { amountVnd: true } }),
      this.prisma.deposit.findMany({ where: { status: DepositStatus.PENDING, expiresAt: { lt: now } }, select: { amountVnd: true } }),
    ]);

    const all: AnalyticsSlice = { deposits, withdrawals, orders, users, kycs, referralCommissions, agencyCommissions };
    const current = this.slice(all, period.start, period.endExclusive);
    const previous = this.slice(all, period.previousStart, period.previousEndExclusive);
    const summary = this.summarize(current, totalInvestors);
    const previousSummary = this.summarize(previous, totalInvestors);
    const failedOrders = orders.filter((row) => row.createdAt >= period.start && row.createdAt < period.endExclusive)
      .filter((row) => row.status === OrderStatus.FAILED);

    return {
      period: {
        from: period.from,
        to: period.to,
        previous_from: period.previousStart.toISOString(),
        previous_to: period.previousEndExclusive.toISOString(),
        granularity: period.granularity,
        timezone: 'Asia/Ho_Chi_Minh',
      },
      summary,
      comparison: {
        deposits_vnd: percentageChange(summary.cash_flow.deposits_vnd, previousSummary.cash_flow.deposits_vnd),
        withdrawals_vnd: percentageChange(summary.cash_flow.withdrawals_vnd, previousSummary.cash_flow.withdrawals_vnd),
        net_revenue_vnd: percentageChange(summary.sales.net_revenue_vnd, previousSummary.sales.net_revenue_vnd),
        peer_sold: percentageChange(summary.sales.peer_sold, previousSummary.sales.peer_sold),
        new_users: percentageChange(summary.users.new_users, previousSummary.users.new_users),
        commission_vnd: percentageChange(summary.commissions.total_vnd, previousSummary.commissions.total_vnd),
      },
      timeseries: this.timeseries(current, period.granularity),
      agency_titles: this.agencyTitles(current.orders),
      top_agencies: this.topAgencies(current.orders),
      alerts: [
        { key: 'stale_withdrawals', level: staleWithdrawals.length ? 'critical' : 'ok', label: 'Lệnh rút chờ quá 24 giờ', count: staleWithdrawals.length, amount_vnd: sum(staleWithdrawals) },
        { key: 'expired_deposits', level: expiredDeposits.length ? 'warning' : 'ok', label: 'QR nạp đã hết hạn chưa khớp', count: expiredDeposits.length, amount_vnd: sum(expiredDeposits) },
        { key: 'stale_deposits', level: staleDeposits.length ? 'warning' : 'ok', label: 'Lệnh nạp chờ quá 30 phút', count: staleDeposits.length, amount_vnd: sum(staleDeposits) },
        { key: 'failed_orders', level: failedOrders.length ? 'critical' : 'ok', label: 'Đơn mua lỗi trong kỳ', count: failedOrders.length, amount_vnd: failedOrders.reduce((total, row) => total + money(row.totalVnd), 0) },
      ],
    };
  }

  private slice(all: AnalyticsSlice, start: Date, end: Date): AnalyticsSlice {
    return {
      deposits: all.deposits.filter((row) => inRange(row.paidAt, start, end)),
      withdrawals: all.withdrawals.filter((row) => inRange(row.reviewedAt, start, end)),
      orders: all.orders.filter((row) => row.createdAt >= start && row.createdAt < end && row.id),
      users: all.users.filter((row) => row.createdAt >= start && row.createdAt < end),
      kycs: all.kycs.filter((row) => inRange(row.reviewedAt, start, end)),
      referralCommissions: all.referralCommissions.filter((row) => row.createdAt >= start && row.createdAt < end),
      agencyCommissions: all.agencyCommissions.filter((row) => row.createdAt >= start && row.createdAt < end),
    };
  }

  private summarize(rows: AnalyticsSlice, totalInvestors: number) {
    const completed = rows.orders.filter((row) => row.status === OrderStatus.COMPLETED);
    const gross = completed.reduce((total, row) => total + money(row.grossTotalVnd ?? row.totalVnd), 0);
    const discounts = completed.reduce((total, row) => total + money(row.discountVnd), 0);
    const revenue = completed.reduce((total, row) => total + money(row.totalVnd), 0);
    const direct = rows.referralCommissions.filter((row) => row.type === ReferralCommissionType.DIRECT);
    const branch = rows.referralCommissions.filter((row) => row.type === ReferralCommissionType.BRANCH);
    const allCommissions = [...rows.referralCommissions, ...rows.agencyCommissions];
    const deposits = rows.deposits.reduce((total, row) => total + money(row.paidAmountVnd ?? row.amountVnd), 0);
    const withdrawals = rows.withdrawals.reduce((total, row) => total + money(row.amountVnd), 0);
    return {
      cash_flow: { deposits_vnd: deposits, withdrawals_vnd: withdrawals, net_vnd: deposits - withdrawals, deposits_count: rows.deposits.length, withdrawals_count: rows.withdrawals.length },
      sales: { gross_revenue_vnd: gross, discounts_vnd: discounts, net_revenue_vnd: revenue, orders: completed.length, peer_sold: completed.reduce((total, row) => total + row.quantity, 0), average_order_vnd: completed.length ? Math.round(revenue / completed.length) : 0 },
      users: { new_users: rows.users.length, kyc_approved: rows.kycs.length, transacting_users: new Set(completed.map((row) => row.userId)).size, total_investors: totalInvestors },
      commissions: {
        direct_vnd: sum(direct), branch_vnd: sum(branch), agency_vnd: sum(rows.agencyCommissions), total_vnd: sum(allCommissions),
        paid_vnd: sum(allCommissions.filter((row) => row.status === CommissionStatus.PAID)),
        earned_vnd: sum(allCommissions.filter((row) => row.status === CommissionStatus.EARNED)),
      },
    };
  }

  private timeseries(rows: AnalyticsSlice, granularity: AnalyticsGranularity) {
    const buckets = new Map<string, { bucket: string; deposits_vnd: number; withdrawals_vnd: number; revenue_vnd: number; commissions_vnd: number; new_users: number; peer_sold: number }>();
    const get = (date: Date) => {
      const key = analyticsBucketKey(date, granularity);
      let bucket = buckets.get(key);
      if (!bucket) { bucket = { bucket: key, deposits_vnd: 0, withdrawals_vnd: 0, revenue_vnd: 0, commissions_vnd: 0, new_users: 0, peer_sold: 0 }; buckets.set(key, bucket); }
      return bucket;
    };
    rows.deposits.forEach((row) => { if (row.paidAt) get(row.paidAt).deposits_vnd += money(row.paidAmountVnd ?? row.amountVnd); });
    rows.withdrawals.forEach((row) => { if (row.reviewedAt) get(row.reviewedAt).withdrawals_vnd += money(row.amountVnd); });
    rows.orders.filter((row) => row.status === OrderStatus.COMPLETED).forEach((row) => { const bucket = get(row.createdAt); bucket.revenue_vnd += money(row.totalVnd); bucket.peer_sold += row.quantity; });
    rows.users.forEach((row) => { get(row.createdAt).new_users += 1; });
    rows.referralCommissions.forEach((row) => { get(row.createdAt).commissions_vnd += money(row.amountVnd); });
    rows.agencyCommissions.forEach((row) => { get(row.createdAt).commissions_vnd += money(row.amountVnd); });
    return [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
  }

  private agencyTitles(orders: AnalyticsSlice['orders']) {
    const grouped = new Map<string, { title: string; orders: number; peer_sold: number; revenue_vnd: number }>();
    orders.filter((row) => row.status === OrderStatus.COMPLETED).forEach((row) => {
      const key = row.agencyTitle ?? 'MEMBER';
      const value = grouped.get(key) ?? { title: key, orders: 0, peer_sold: 0, revenue_vnd: 0 };
      value.orders += 1; value.peer_sold += row.quantity; value.revenue_vnd += money(row.totalVnd); grouped.set(key, value);
    });
    return [...grouped.values()].sort((a, b) => b.revenue_vnd - a.revenue_vnd);
  }

  private topAgencies(orders: AnalyticsSlice['orders']) {
    const grouped = new Map<string, { id: string; code: string; name: string; owner: string; orders: number; peer_sold: number; revenue_vnd: number }>();
    orders.filter((row) => row.status === OrderStatus.COMPLETED).forEach((row) => {
      if (!row.agency) return;
      const value = grouped.get(row.agency.id) ?? { id: row.agency.id, code: row.agency.code, name: row.agency.businessName, owner: row.agency.user.fullName, orders: 0, peer_sold: 0, revenue_vnd: 0 };
      value.orders += 1; value.peer_sold += row.quantity; value.revenue_vnd += money(row.totalVnd); grouped.set(row.agency.id, value);
    });
    return [...grouped.values()].sort((a, b) => b.revenue_vnd - a.revenue_vnd).slice(0, 10);
  }
}
