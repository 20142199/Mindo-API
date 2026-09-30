import { ConflictException, NotFoundException } from '@nestjs/common';
import { DepositStatus, Prisma } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Phase1Service } from './phase1.service';

const deposit = (overrides: Record<string, unknown> = {}) => ({
  id: 'dep-1',
  userId: 'investor',
  amountVnd: new Prisma.Decimal('500000'),
  transferCode: 'MIABC123',
  status: DepositStatus.PENDING,
  bankTransactionId: null,
  vietQrData: null,
  expiresAt: new Date(Date.now() + 60_000),
  ...overrides,
});

const serviceWith = (prisma: unknown) =>
  new Phase1Service(prisma as never, {} as never, {} as never, {} as never, {} as never);

describe('cancel a deposit', () => {
  it('does not reveal a deposit that belongs to someone else', async () => {
    const prisma = { deposit: { findFirst: vi.fn().mockResolvedValue(null) } };

    await expect(serviceWith(prisma).cancelDeposit('investor', 'dep-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.deposit.findFirst).toHaveBeenCalledWith({ where: { id: 'dep-1', userId: 'investor' } });
  });

  it('cancels a pending deposit and records who did it', async () => {
    const prisma = {
      deposit: {
        findFirst: vi.fn().mockResolvedValue(deposit()),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve(deposit(data))),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };

    const result = await serviceWith(prisma).cancelDeposit('investor', 'dep-1');

    expect(prisma.deposit.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'dep-1' },
      data: expect.objectContaining({ status: DepositStatus.CANCELLED }),
    }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorId: 'investor', action: 'DEPOSIT_CANCELLED', entityId: 'dep-1' }),
    });
    expect(result.display_status).toBe('cancelled');
  });

  it('returns an already cancelled deposit unchanged', async () => {
    const prisma = {
      deposit: {
        findFirst: vi.fn().mockResolvedValue(deposit({ status: DepositStatus.CANCELLED })),
        update: vi.fn(),
      },
    };

    const result = await serviceWith(prisma).cancelDeposit('investor', 'dep-1');

    expect(prisma.deposit.update).not.toHaveBeenCalled();
    expect(result.display_status).toBe('cancelled');
  });

  it('refuses to cancel a deposit that has been paid', async () => {
    const prisma = {
      deposit: {
        findFirst: vi.fn().mockResolvedValue(deposit({ status: DepositStatus.CONFIRMED })),
        update: vi.fn(),
      },
    };

    await expect(serviceWith(prisma).cancelDeposit('investor', 'dep-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.deposit.update).not.toHaveBeenCalled();
  });
});

describe('money that arrives after a deposit was cancelled', () => {
  afterEach(() => {
    delete process.env.VIETQR_BANK_ACCOUNT;
  });

  const txFor = (found: ReturnType<typeof deposit>, lookup: 'orderId' | 'content') => ({
    deposit: {
      findUnique: vi.fn().mockImplementation(({ where }) =>
        Promise.resolve(lookup === 'orderId' && where.vietQrOrderId ? found : null)),
      findMany: vi.fn().mockImplementation(({ where }) =>
        Promise.resolve(where.status.in.includes(found.status) ? [found] : [])),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...found, ...data })),
    },
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'investor', balanceVnd: new Prisma.Decimal('100000') }),
      update: vi.fn().mockResolvedValue({}),
    },
    ledgerEntry: { create: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  });

  const callback = (overrides: Record<string, unknown> = {}) => ({
    bankaccount: '0011001234567',
    amount: 500000,
    transType: 'C',
    content: 'MIABC123 chuyen tien',
    transactionid: 'BANK-TX-1',
    ...overrides,
  });

  it('still credits the wallet and notes why', async () => {
    const tx = txFor(deposit({ status: DepositStatus.CANCELLED }), 'orderId');
    const prisma = { $transaction: vi.fn((run: (client: typeof tx) => unknown) => run(tx)) };

    await serviceWith(prisma).syncVietQrPayment(callback({ orderId: '123456' }) as never);

    expect(tx.deposit.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: DepositStatus.CONFIRMED,
        reviewNote: expect.stringContaining('sau khi lệnh đã huỷ'),
      }),
    }));
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'investor' }, data: { balanceVnd: new Prisma.Decimal('600000') } });
    expect(tx.ledgerEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ direction: 'CREDIT' }) });
  });

  it('finds a cancelled deposit from the transfer content', async () => {
    const tx = txFor(deposit({ status: DepositStatus.CANCELLED }), 'content');
    const prisma = { $transaction: vi.fn((run: (client: typeof tx) => unknown) => run(tx)) };

    await serviceWith(prisma).syncVietQrPayment(callback() as never);

    expect(tx.deposit.findMany.mock.calls[0][0].where.status.in).toContain(DepositStatus.CANCELLED);
    expect(tx.deposit.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: DepositStatus.CONFIRMED }),
    }));
  });
});
