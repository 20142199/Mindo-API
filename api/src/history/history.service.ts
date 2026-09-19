import { Injectable, NotFoundException } from '@nestjs/common';
import { DepositStatus, OrderStatus, Prisma } from '@prisma/client';
import { pageExtra } from '../common/api-response';
import { PrismaService } from '../common/prisma.module';
import { DepositHistoryQueryDto, HistoryStatus, NftHistoryQueryDto } from './history.dto';
import {
  depositHistoryStatus,
  groupHistoryByMonth,
  historyDateRange,
  historyLabels,
  orderHistoryStatus,
  shortAssetCode,
} from './history.domain';

@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async nftHistory(userId: string, query: NftHistoryQueryDto) {
    const createdAt = historyDateRange(query.from, query.to);
    const where: Prisma.PurchaseOrderWhereInput = {
      userId,
      ...(query.project_id ? { productId: query.project_id } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(query.status ? { status: this.orderStatus(query.status) } : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const [total, rows, summary] = await Promise.all([
      this.prisma.purchaseOrder.count({ where }),
      this.prisma.purchaseOrder.findMany({
        where,
        include: { product: true, nftAssets: { orderBy: { issuedAt: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit,
      }),
      this.nftSummary(userId),
    ]);
    const items = rows.map((row) => {
      const status = orderHistoryStatus(row.status);
      const code = shortAssetCode(row.nftAssets[0]?.assetCode);
      return {
        id: row.id,
        type: 'nft_purchase',
        title: `${row.product.name}${code ? ` ${code}` : row.quantity > 1 ? ` · ${row.quantity} NFT` : ''}`,
        collection_id: row.productId,
        collection_name: row.product.name,
        quantity: row.quantity,
        nft_codes: row.nftAssets.map((asset) => asset.assetCode),
        amount_vnd: row.totalVnd.toString(),
        status,
        status_label: historyLabels[status],
        occurred_at: row.createdAt.toISOString(),
      };
    });
    return {
      data: {
        summary,
        groups: groupHistoryByMonth(items),
        applied_filters: { from: query.from ?? null, to: query.to ?? null, status: query.status ?? null, project_id: query.project_id ?? null },
      },
      extra: pageExtra(query.page, query.limit, total),
    };
  }

  async nftDetail(userId: string, id: string) {
    const row = await this.prisma.purchaseOrder.findFirst({
      where: { id, userId },
      include: { product: true, nftAssets: { orderBy: { issuedAt: 'asc' } } },
    });
    if (!row) throw new NotFoundException('Không tìm thấy giao dịch mua NFT');
    const status = orderHistoryStatus(row.status);
    const firstCode = shortAssetCode(row.nftAssets[0]?.assetCode);
    return {
      id: row.id,
      transaction_code: `TX#${row.id.slice(-8).toUpperCase()}`,
      type: 'nft_purchase',
      transaction_type: 'primary_purchase',
      status,
      status_label: historyLabels[status],
      title: status === HistoryStatus.COMPLETED ? 'Mua NFT thành công' : `Mua NFT · ${historyLabels[status]}`,
      amount_vnd: row.totalVnd.toString(),
      occurred_at: row.createdAt.toISOString(),
      overview: {
        collection_id: row.productId,
        collection_name: row.product.name,
        nft_code: firstCode,
        nft_codes: row.nftAssets.map((asset) => asset.assetCode),
        quantity: row.quantity,
        total_value_vnd: row.totalVnd.toString(),
      },
      execution: {
        ownership_system: 'MINDO_INTERNAL',
        buyer_account_id: userId,
        executed_via: 'Sàn sơ cấp Mindo',
        blockchain_transaction: null,
        wallet_sender: null,
        wallet_receiver: null,
      },
      nft_source: {
        seller: 'Dự án',
        issuance_round: null,
        unit_price_vnd: row.unitPriceVnd.toString(),
      },
      note: row.product.description,
      navigation: {
        collection_id: row.productId,
        nft_asset_ids: row.nftAssets.map((asset) => asset.id),
      },
    };
  }

  async depositHistory(userId: string, query: DepositHistoryQueryDto) {
    const createdAt = historyDateRange(query.from, query.to);
    const where: Prisma.DepositWhereInput = {
      userId,
      ...(createdAt ? { createdAt } : {}),
      ...(query.status ? { status: this.depositStatus(query.status) } : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const [total, rows, summary] = await Promise.all([
      this.prisma.deposit.count({ where }),
      this.prisma.deposit.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: query.limit }),
      this.depositSummary(userId),
    ]);
    const items = rows.map((row) => {
      const status = depositHistoryStatus(row.status);
      return {
        id: row.id,
        type: 'deposit',
        title: 'VietQR',
        source: 'VIETQR',
        amount_vnd: row.amountVnd.toString(),
        status,
        status_label: historyLabels[status],
        status_message: status === HistoryStatus.PENDING
          ? 'Giao dịch đã ghi nhận, đang chờ đối soát với ngân hàng. Thường hoàn tất trong 5–10 phút.'
          : null,
        occurred_at: (row.paidAt ?? row.createdAt).toISOString(),
      };
    });
    return {
      data: {
        summary,
        available_sources: [{ value: 'VIETQR', label: 'VietQR' }],
        groups: groupHistoryByMonth(items),
        applied_filters: { from: query.from ?? null, to: query.to ?? null, status: query.status ?? null, source: query.source ?? null },
      },
      extra: pageExtra(query.page, query.limit, total),
    };
  }

  async depositDetail(userId: string, id: string) {
    const row = await this.prisma.deposit.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('Không tìm thấy giao dịch nạp tiền');
    const status = depositHistoryStatus(row.status);
    const occurredAt = row.paidAt ?? row.reviewedAt ?? row.createdAt;
    return {
      id: row.id,
      transaction_code: row.bankTransactionId ?? row.transferCode,
      type: 'deposit',
      status,
      status_label: historyLabels[status],
      status_message: status === HistoryStatus.PENDING
        ? 'Giao dịch đã ghi nhận, đang chờ đối soát với ngân hàng. Thường hoàn tất trong 5–10 phút.'
        : row.status === DepositStatus.REJECTED ? row.reviewNote ?? 'Giao dịch không được xác nhận' : null,
      title: status === HistoryStatus.COMPLETED ? 'Nạp tiền thành công' : `Nạp tiền · ${historyLabels[status]}`,
      amount_vnd: row.amountVnd.toString(),
      occurred_at: occurredAt.toISOString(),
      overview: {
        method: 'bank_transfer',
        method_label: 'Chuyển khoản ngân hàng',
        transaction_type: 'deposit',
        paid_amount_vnd: row.paidAmountVnd?.toString() ?? null,
        fee_vnd: '0',
      },
      source: {
        provider: 'VIETQR',
        source_account_masked: null,
        transfer_content: row.transferCode,
        sender_bank: null,
        source_data_available: false,
        bank_reference_number: row.bankReferenceNumber,
      },
      wallet_credit: {
        receiving_account: 'Ví Mindo',
        balance_before_vnd: row.balanceBeforeVnd?.toString() ?? null,
        balance_after_vnd: row.balanceAfterVnd?.toString() ?? null,
      },
      note: 'Giao dịch nạp tiền vào ví Mindo qua chuyển khoản ngân hàng. Số tiền được ghi nhận sau khi hệ thống đối soát thành công.',
      receipt: {
        available: row.status === DepositStatus.CONFIRMED,
        url: row.status === DepositStatus.CONFIRMED ? `/api/v1/investor/history/deposits/${row.id}/receipt` : null,
      },
    };
  }

  async depositReceipt(userId: string, id: string) {
    const detail = await this.depositDetail(userId, id);
    if (!detail.receipt.available) throw new NotFoundException('Biên lai chỉ có sau khi giao dịch hoàn tất');
    const lines = [
      'BIÊN LAI NẠP TIỀN MINDO',
      `Mã giao dịch: ${detail.transaction_code}`,
      `Trạng thái: ${detail.status_label}`,
      `Số tiền: ${detail.amount_vnd} VND`,
      `Thời gian: ${detail.occurred_at}`,
      `Phương thức: ${detail.overview.method_label}`,
      `Nội dung chuyển khoản: ${detail.source.transfer_content}`,
      `Số dư trước nạp: ${detail.wallet_credit.balance_before_vnd ?? 'Không có dữ liệu'}`,
      `Số dư sau nạp: ${detail.wallet_credit.balance_after_vnd ?? 'Không có dữ liệu'}`,
      '',
      'Biên lai được tạo tự động bởi Mindo.',
    ];
    return { filename: `mindo-deposit-${id}.txt`, content: Buffer.from(lines.join('\n'), 'utf8') };
  }

  private async nftSummary(userId: string) {
    const [spent, holdings] = await Promise.all([
      this.prisma.purchaseOrder.aggregate({ where: { userId, status: OrderStatus.COMPLETED }, _sum: { totalVnd: true } }),
      this.prisma.nftAsset.groupBy({ by: ['productId'], where: { ownerId: userId }, _count: { _all: true } }),
    ]);
    const products = holdings.length
      ? await this.prisma.nftProduct.findMany({ where: { id: { in: holdings.map((item) => item.productId) } }, select: { id: true, unitPriceVnd: true } })
      : [];
    const prices = new Map(products.map((product) => [product.id, product.unitPriceVnd]));
    const currentValue = holdings.reduce(
      (total, item) => total.plus((prices.get(item.productId) ?? new Prisma.Decimal(0)).mul(item._count._all)),
      new Prisma.Decimal(0),
    );
    const totalSpent = spent._sum.totalVnd ?? new Prisma.Decimal(0);
    const totalAssets = holdings.reduce((total, item) => total + item._count._all, 0);
    return {
      scope: 'all_time',
      total_spent_vnd: totalSpent.toString(),
      estimated_profit_loss_vnd: currentValue.minus(totalSpent).toString(),
      estimated_current_value_vnd: currentValue.toString(),
      valuation_basis: 'current_collection_price',
      total_nfts_owned: totalAssets,
      holding_nfts: totalAssets,
    };
  }

  private async depositSummary(userId: string) {
    const [totalCount, completedCount, pendingCount, amount] = await Promise.all([
      this.prisma.deposit.count({ where: { userId } }),
      this.prisma.deposit.count({ where: { userId, status: DepositStatus.CONFIRMED } }),
      this.prisma.deposit.count({ where: { userId, status: DepositStatus.PENDING } }),
      this.prisma.deposit.aggregate({ where: { userId, status: DepositStatus.CONFIRMED }, _sum: { amountVnd: true } }),
    ]);
    return {
      scope: 'all_time',
      total_deposited_vnd: (amount._sum.amountVnd ?? new Prisma.Decimal(0)).toString(),
      completed_count: completedCount,
      total_count: totalCount,
      pending_count: pendingCount,
    };
  }

  private orderStatus(status: HistoryStatus): OrderStatus {
    const values: Record<HistoryStatus, OrderStatus> = {
      [HistoryStatus.PENDING]: OrderStatus.PENDING,
      [HistoryStatus.COMPLETED]: OrderStatus.COMPLETED,
      [HistoryStatus.FAILED]: OrderStatus.FAILED,
      [HistoryStatus.CANCELLED]: OrderStatus.CANCELLED,
    };
    return values[status];
  }

  private depositStatus(status: HistoryStatus): DepositStatus {
    if (status === HistoryStatus.COMPLETED) return DepositStatus.CONFIRMED;
    if (status === HistoryStatus.PENDING) return DepositStatus.PENDING;
    return DepositStatus.REJECTED;
  }
}
