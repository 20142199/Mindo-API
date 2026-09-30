import { Prisma, WithdrawalStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { WithdrawalService } from './withdrawal.service';

const withdrawal = (status = WithdrawalStatus.PENDING) => ({
  id: 'withdrawal-1', userId: 'user-1', amountVnd: new Prisma.Decimal(300000),
  bankName: 'ACB', bankAccountNumber: '13989647', bankAccountName: 'TRAN DUY HUNG',
  status, idempotencyKey: 'request-123', balanceBeforeVnd: new Prisma.Decimal(1000000),
  balanceAfterVnd: new Prisma.Decimal(700000), reviewedById: null, reviewedAt: null,
  reviewNote: null, rejectionReason: null, transferProofFileId: null,
  bankTransactionCode: null, refundedAt: null, createdAt: new Date(), updatedAt: new Date(),
});

const serviceWith = (prisma: object, files: object = {}, push: object = {}, telegram: object = { isConfigured: () => false }) => new WithdrawalService(
  prisma as never, files as never, push as never, telegram as never,
);

describe('withdrawal money safety', () => {
  it('debits the balance and writes the ledger in the same serializable transaction', async () => {
    const row = withdrawal();
    const tx = {
      withdrawal: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(row) },
      user: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: vi.fn().mockResolvedValue({ balanceVnd: new Prisma.Decimal(700000) }) },
      ledgerEntry: { create: vi.fn().mockResolvedValue({}) }, auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: vi.fn((handler) => handler(tx)), fileUpload: { findMany: vi.fn() } };
    const service = serviceWith(prisma);

    await service.create('user-1', 'request-123', { amount_vnd: '300000', bank_name: 'ACB', bank_account_number: '13989647', bank_account_name: 'Tran Duy Hung' });

    expect(tx.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { balanceVnd: { decrement: new Prisma.Decimal(300000) } } }));
    expect(tx.withdrawal.create).toHaveBeenCalledOnce();
    expect(tx.ledgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ direction: 'DEBIT', withdrawalId: 'withdrawal-1' }) }));
  });

  it('returns the same request without debiting twice', async () => {
    const row = withdrawal();
    const tx = {
      withdrawal: { findUnique: vi.fn().mockResolvedValue(row) },
      user: { updateMany: vi.fn() }, ledgerEntry: { create: vi.fn() }, auditLog: { create: vi.fn() },
    };
    const prisma = { $transaction: vi.fn((handler) => handler(tx)), fileUpload: { findMany: vi.fn() } };
    const service = serviceWith(prisma);

    await service.create('user-1', 'request-123', { amount_vnd: '300000', bank_name: 'ACB', bank_account_number: '13989647', bank_account_name: 'Tran Duy Hung' });

    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(tx.ledgerEntry.create).not.toHaveBeenCalled();
  });

  it('rejects reuse of an idempotency key with a different payload', async () => {
    const row = withdrawal();
    const tx = {
      withdrawal: { findUnique: vi.fn().mockResolvedValue(row) },
      user: { updateMany: vi.fn() }, ledgerEntry: { create: vi.fn() }, auditLog: { create: vi.fn() },
    };
    const prisma = { $transaction: vi.fn((handler) => handler(tx)), fileUpload: { findMany: vi.fn() } };
    const service = serviceWith(prisma);

    await expect(service.create('user-1', 'request-123', {
      amount_vnd: '400000', bank_name: 'ACB', bank_account_number: '13989647', bank_account_name: 'Tran Duy Hung',
    })).rejects.toThrow('Idempotency-Key đã được dùng cho một lệnh rút khác');

    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });

  it('refunds a rejected withdrawal exactly once', async () => {
    const pending = withdrawal();
    const rejected = { ...pending, status: WithdrawalStatus.REJECTED, rejectionReason: 'Sai tài khoản', refundedAt: new Date() };
    const tx = {
      withdrawal: {
        findUnique: vi.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce(rejected),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(rejected),
      },
      user: { update: vi.fn().mockResolvedValue({}) }, ledgerEntry: { create: vi.fn().mockResolvedValue({}) }, auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: vi.fn((handler) => handler(tx)), fileUpload: { findMany: vi.fn() } };
    const push = { notifyWithdrawalResult: vi.fn().mockResolvedValue({ sent: 1 }) };
    const service = serviceWith(prisma, {}, push);

    await service.reject('admin-1', pending.id, { reason: 'Sai tài khoản' });
    await service.reject('admin-1', pending.id, { reason: 'Sai tài khoản' });

    expect(tx.user.update).toHaveBeenCalledOnce();
    expect(tx.ledgerEntry.create).toHaveBeenCalledOnce();
    expect(push.notifyWithdrawalResult).toHaveBeenCalledOnce();
  });

  it('approves with proof and bank transaction code without debiting again', async () => {
    const pending = withdrawal();
    const approved = { ...pending, status: WithdrawalStatus.APPROVED, transferProofFileId: 'proof-1', bankTransactionCode: 'ACB-TX-1' };
    const tx = {
      withdrawal: { findUnique: vi.fn().mockResolvedValue(pending), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: vi.fn().mockResolvedValue(approved) },
      auditLog: { create: vi.fn().mockResolvedValue({}) }, user: { update: vi.fn() },
    };
    const prisma = { $transaction: vi.fn((handler) => handler(tx)), fileUpload: { findMany: vi.fn().mockResolvedValue([{ id: 'proof-1', originalName: 'proof.png', mimeType: 'image/png', size: 10, ownerId: 'admin-1', storedName: 'proof.png', createdAt: new Date() }]) } };
    const files = { assertOwned: vi.fn().mockResolvedValue({ id: 'proof-1', mimeType: 'image/png' }), view: vi.fn().mockReturnValue({ id: 'proof-1', public_url: 'https://example.test/proof.png' }) };
    const push = { notifyWithdrawalResult: vi.fn().mockResolvedValue({ sent: 1 }) };
    const service = serviceWith(prisma, files, push);

    await service.approve('admin-1', pending.id, { transaction_code: 'acb-tx-1', transfer_proof_file_id: 'proof-1' });

    expect(tx.withdrawal.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: WithdrawalStatus.APPROVED, bankTransactionCode: 'ACB-TX-1', transferProofFileId: 'proof-1' }) }));
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(push.notifyWithdrawalResult).toHaveBeenCalledOnce();
  });
});
