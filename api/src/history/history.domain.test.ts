import { BadRequestException } from '@nestjs/common';
import { DepositStatus, OrderStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { depositHistoryStatus, groupHistoryByMonth, historyDateRange, orderHistoryStatus, shortAssetCode } from './history.domain';

describe('history domain', () => {
  it('maps internal transaction statuses to app history statuses', () => {
    expect(orderHistoryStatus(OrderStatus.COMPLETED)).toBe('completed');
    expect(orderHistoryStatus(OrderStatus.CANCELLED)).toBe('cancelled');
    expect(depositHistoryStatus(DepositStatus.CONFIRMED)).toBe('completed');
    expect(depositHistoryStatus(DepositStatus.REJECTED)).toBe('failed');
  });

  it('uses Vietnam day boundaries and rejects reversed dates', () => {
    const range = historyDateRange('2026-09-01', '2026-09-17');
    expect(range?.gte?.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    expect(range?.lte?.toISOString()).toBe('2026-09-17T16:59:59.999Z');
    expect(() => historyDateRange('2026-09-18', '2026-09-17')).toThrow(BadRequestException);
  });

  it('groups sorted history rows by Vietnam calendar month', () => {
    const groups = groupHistoryByMonth([
      { id: 'a', occurred_at: '2026-09-01T00:00:00.000Z' },
      { id: 'b', occurred_at: '2026-08-31T18:00:00.000Z' },
      { id: 'c', occurred_at: '2026-08-01T00:00:00.000Z' },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ key: '2026-09', label: 'THÁNG 9/2026' });
    expect(groups[0].items.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('creates a short internal NFT code for display', () => {
    expect(shortAssetCode('MINDO-ORDER-0007')).toBe('#0007');
    expect(shortAssetCode(undefined)).toBeNull();
  });
});
