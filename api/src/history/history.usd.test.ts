import { OrderStatus, Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { Phase1Service } from '../phase1/phase1.service';
import { vndToUsd } from './history.domain';
import { HistoryService } from './history.service';

const product = { id: 'peer', name: 'Mindo Peer', symbol: 'PEER', description: '', imageUrl: '', totalSupply: 5000, soldCount: 60, unitPriceVnd: new Prisma.Decimal('650000') };

/** Đơn mới lưu tỷ giá lúc mua; đơn cũ trước migration thì không. */
const orders = [
  {
    id: 'order-new',
    userId: 'investor',
    productId: 'peer',
    quantity: 2,
    unitPriceVnd: new Prisma.Decimal('650000'),
    totalVnd: new Prisma.Decimal('1040000'),
    grossTotalVnd: new Prisma.Decimal('1300000'),
    discountVnd: new Prisma.Decimal('260000'),
    effectiveDiscountRate: new Prisma.Decimal('0.2'),
    agencyTitle: 'TIER_1',
    unitPriceUsd: new Prisma.Decimal('25'),
    usdVndRate: new Prisma.Decimal('26000'),
    pricingBreakdown: [],
    referralCode: null,
    status: OrderStatus.COMPLETED,
    createdAt: new Date('2026-09-29T03:00:00.000Z'),
    product,
    nftAssets: [{ id: 'asset-1', assetCode: 'MINDO-ORDER-NEW-0001', issuedAt: new Date('2026-09-29T03:00:00.000Z') }],
  },
  {
    id: 'order-old',
    userId: 'investor',
    productId: 'peer',
    quantity: 1,
    unitPriceVnd: new Prisma.Decimal('500000'),
    totalVnd: new Prisma.Decimal('500000'),
    grossTotalVnd: null,
    discountVnd: null,
    effectiveDiscountRate: null,
    agencyTitle: null,
    unitPriceUsd: null,
    usdVndRate: null,
    pricingBreakdown: null,
    referralCode: null,
    status: OrderStatus.COMPLETED,
    createdAt: new Date('2026-09-01T03:00:00.000Z'),
    product,
    nftAssets: [{ id: 'asset-2', assetCode: 'MINDO-ORDER-OLD-0001', issuedAt: new Date('2026-09-01T03:00:00.000Z') }],
  },
];

const historyPrisma = () => ({
  purchaseOrder: {
    count: vi.fn().mockResolvedValue(orders.length),
    findMany: vi.fn().mockImplementation((args) => Promise.resolve(args.select
      ? orders.map((order) => ({ totalVnd: order.totalVnd, usdVndRate: order.usdVndRate }))
      : orders)),
    findFirst: vi.fn().mockResolvedValue(orders[0]),
    aggregate: vi.fn().mockResolvedValue({ _sum: { totalVnd: new Prisma.Decimal('1540000') } }),
  },
  nftAsset: { groupBy: vi.fn().mockResolvedValue([{ productId: 'peer', _count: { _all: 3 } }]) },
  nftProduct: { findMany: vi.fn().mockResolvedValue([{ id: 'peer', unitPriceVnd: new Prisma.Decimal('650000') }]) },
  agencyPackageSetting: { findUnique: vi.fn().mockResolvedValue({ usdVndRate: new Prisma.Decimal('25000') }) },
});

describe('USD in Peer history', () => {
  it('converts VND to a two-decimal USD string', () => {
    expect(vndToUsd(new Prisma.Decimal('650000'), new Prisma.Decimal('26000'))).toBe('25.00');
  });

  it('prices each purchase at its own rate, and old ones at the current rate', async () => {
    const service = new HistoryService(historyPrisma() as never);

    const result = await service.nftHistory('investor', { page: 1, limit: 20 } as never);

    const items = result.data.groups.flatMap((group: { items: Array<Record<string, unknown>> }) => group.items);
    expect(items.find((item) => item.id === 'order-new')).toMatchObject({ amount_usd: '40.00', gross_amount_usd: '50.00', discount_usd: '10.00' });
    expect(items.find((item) => item.id === 'order-old')).toMatchObject({ amount_usd: '20.00', gross_amount_usd: '20.00', discount_usd: '0.00' });
    expect(result.data.summary.total_spent_usd).toBe('60.00');
  });

  it('adds USD to a purchase detail', async () => {
    const service = new HistoryService(historyPrisma() as never);

    const detail = await service.nftDetail('investor', 'order-new');

    expect(detail).toMatchObject({ amount_usd: '40.00', gross_amount_usd: '50.00', discount_usd: '10.00' });
  });
});

describe('USD on an owned Peer', () => {
  it('reports what one Peer actually cost after discount', async () => {
    const asset = {
      id: 'asset-1',
      assetCode: 'MINDO-ORDER-NEW-0001',
      metadataUrl: 'https://example.test/1.json',
      issuedAt: new Date('2026-09-29T03:00:00.000Z'),
      product,
      order: orders[0],
    };
    const prisma = {
      nftAsset: { findFirst: vi.fn().mockResolvedValue(asset) },
      agencyPackageSetting: { findUnique: vi.fn().mockResolvedValue({ usdVndRate: new Prisma.Decimal('25000') }) },
    };
    const service = new Phase1Service(prisma as never, {} as never, {} as never, {} as never, {} as never, { isConfigured: () => false } as never);

    const peer = await service.myNftDetail('investor', 'asset-1');

    expect(peer.purchase).toMatchObject({
      quantity: 2,
      effective_unit_price_vnd: '520000',
      effective_unit_price_usd: '20.00',
      usd_vnd_rate: '26000',
    });
  });
});
