import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { Phase1Service } from './phase1.service';

describe('web Peer purchase quote', () => {
  it('splits a purchase at the 50-Peer discount boundary', async () => {
    const prisma = {
      nftProduct: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'peer',
          isActive: true,
          totalSupply: 5_000,
          soldCount: 0,
        }),
      },
      user: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'buyer',
          agencyTitle: null,
          totalPackagesPurchased: 0,
          balanceVnd: new Prisma.Decimal('100000000'),
          kycVerifiedAt: new Date(),
        }),
      },
      agencyPackageSetting: {
        upsert: vi.fn().mockResolvedValue({
          basePriceUsd: new Prisma.Decimal('25'),
          usdVndRate: new Prisma.Decimal('26000'),
          updatedAt: new Date('2026-09-27T00:00:00.000Z'),
        }),
      },
    };
    const service = new Phase1Service(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { isConfigured: () => false } as never,
    );

    const quote = await service.calculatePrice('buyer', 'peer', 50);

    expect(quote).toMatchObject({
      amount: 50,
      agency_title: 'TIER_2',
      agency_title_label: 'Đại lý Bạch Kim',
      gross_total_vnd: '32500000',
      total_vnd: '25935000',
      discount_vnd: '6565000',
      starting_package_number: 1,
      ending_package_number: 50,
      can_purchase: true,
    });
    expect(quote.pricing_breakdown).toEqual([
      expect.objectContaining({ tier: 'TIER_1', quantity: 49, net_amount_vnd: 25_480_000 }),
      expect.objectContaining({ tier: 'TIER_2', quantity: 1, net_amount_vnd: 455_000 }),
    ]);
  });
});
