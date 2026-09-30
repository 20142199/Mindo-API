import { BadRequestException } from '@nestjs/common';
import { DepositStatus, Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { Phase1Service } from './phase1.service';

const serviceWith = (prisma: object) => new Phase1Service(
  prisma as never,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  { isConfigured: () => false } as never,
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

  it('credits a VietQR deposit automatically from the callback', async () => {
    const deposit = {
      id: 'deposit-1', userId: 'user-1', status: DepositStatus.PENDING,
      amountVnd: new Prisma.Decimal(250000), transferCode: 'MINDO123',
    };
    const tx = {
      deposit: {
        findUnique: vi.fn().mockResolvedValue(deposit),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...deposit, ...data })),
      },
      user: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'user-1', balanceVnd: new Prisma.Decimal(100000) }),
        update: vi.fn().mockResolvedValue({}),
      },
      ledgerEntry: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: vi.fn((handler) => handler(tx)) };
    const service = serviceWith(prisma);

    await service.syncVietQrPayment({
      bankaccount: '13989647', amount: 250000, transType: 'C', content: 'MINDO123',
      transactionid: 'bank-tx-1', referencenumber: 'bank-ref-1', orderId: 'order-1',
    });

    expect(tx.deposit.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'deposit-1' },
      data: expect.objectContaining({
        status: DepositStatus.CONFIRMED,
        bankTransactionId: 'bank-tx-1',
        reviewNote: 'Xác nhận tự động qua webhook VietQR',
      }),
    }));
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { balanceVnd: new Prisma.Decimal(350000) } });
    expect(tx.ledgerEntry.create).toHaveBeenCalledOnce();
  });
});
