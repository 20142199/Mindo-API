import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { Phase1Service } from './phase1.service';

const serviceWith = (prisma: object) => new Phase1Service(
  prisma as never,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
);

describe('admin operations', () => {
  it('never allows product supply below the amount already issued', async () => {
    const prisma = {
      nftProduct: {
        findUnique: vi.fn().mockResolvedValue({ id: 'peer-1', soldCount: 12 }),
        update: vi.fn(),
      },
    };
    const service = serviceWith(prisma);

    await expect(service.updateProduct('peer-1', { total_supply: 11 })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.nftProduct.update).not.toHaveBeenCalled();
  });

  it('normalizes the product symbol and maps admin field names', async () => {
    const prisma = {
      nftProduct: {
        findUnique: vi.fn().mockResolvedValue({ id: 'peer-1', soldCount: 12 }),
        update: vi.fn().mockResolvedValue({ id: 'peer-1' }),
      },
    };
    const service = serviceWith(prisma);

    await service.updateProduct('peer-1', { name: ' Mindo Prime ', symbol: ' peer ', total_supply: 200, is_active: false });

    expect(prisma.nftProduct.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'peer-1' },
      data: expect.objectContaining({ name: 'Mindo Prime', symbol: 'PEER', totalSupply: 200, isActive: false }),
    }));
  });

  it('uses a safe user projection for the admin transaction list', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = serviceWith({ purchaseOrder: { findMany } });

    await service.transactions();

    const select = findMany.mock.calls[0][0].include.user.select;
    expect(select).toMatchObject({ id: true, email: true, fullName: true });
    expect(select).not.toHaveProperty('passwordHash');
  });
});
