import { BadRequestException } from '@nestjs/common';
import { DepositStatus, OrderStatus } from '@prisma/client';
import { HistoryStatus } from './history.dto';

const vietnamMonth = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
});

export const historyLabels: Record<HistoryStatus, string> = {
  [HistoryStatus.PENDING]: 'Đang xử lý',
  [HistoryStatus.COMPLETED]: 'Thành công',
  [HistoryStatus.FAILED]: 'Thất bại',
  [HistoryStatus.CANCELLED]: 'Đã huỷ',
};

export function orderHistoryStatus(status: OrderStatus): HistoryStatus {
  if (status === OrderStatus.COMPLETED) return HistoryStatus.COMPLETED;
  if (status === OrderStatus.PENDING) return HistoryStatus.PENDING;
  if (status === OrderStatus.CANCELLED) return HistoryStatus.CANCELLED;
  return HistoryStatus.FAILED;
}

export function depositHistoryStatus(status: DepositStatus): HistoryStatus {
  if (status === DepositStatus.CONFIRMED) return HistoryStatus.COMPLETED;
  if (status === DepositStatus.PENDING) return HistoryStatus.PENDING;
  return HistoryStatus.FAILED;
}

export function historyDateRange(from?: string, to?: string) {
  const start = from ? new Date(`${from}T00:00:00.000+07:00`) : undefined;
  const end = to ? new Date(`${to}T23:59:59.999+07:00`) : undefined;
  if (start && end && start > end) throw new BadRequestException('Từ ngày phải trước hoặc bằng đến ngày');
  if (!start && !end) return undefined;
  return { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
}

export function groupHistoryByMonth<T extends { occurred_at: string }>(items: T[]) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const parts = vietnamMonth.formatToParts(new Date(item.occurred_at));
    const year = parts.find((part) => part.type === 'year')?.value ?? '';
    const month = parts.find((part) => part.type === 'month')?.value ?? '';
    const key = `${year}-${month}`;
    const current = groups.get(key) ?? [];
    current.push(item);
    groups.set(key, current);
  }
  return [...groups.entries()].map(([key, groupedItems]) => ({
    key,
    label: `THÁNG ${Number(key.slice(5, 7))}/${key.slice(0, 4)}`,
    items: groupedItems,
  }));
}

export function shortAssetCode(assetCode?: string) {
  if (!assetCode) return null;
  const suffix = assetCode.match(/-(\d+)$/)?.[1];
  return suffix ? `#${suffix}` : assetCode;
}
