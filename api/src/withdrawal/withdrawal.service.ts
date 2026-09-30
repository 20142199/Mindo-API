import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, UserStatus, Withdrawal, WithdrawalStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.module';
import { PushNotificationService } from '../notification/push-notification.service';
import { TelegramNotificationService } from '../notification/telegram-notification.service';
import { FileStorageService } from '../phase1/file-storage.service';
import { ApproveWithdrawalDto, CreateWithdrawalDto, RejectWithdrawalDto } from './withdrawal.dto';

@Injectable()
export class WithdrawalService {
  private readonly logger = new Logger(WithdrawalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileStorageService,
    private readonly push: PushNotificationService,
    private readonly telegram: TelegramNotificationService,
  ) {}

  async create(userId: string, idempotencyKey: string, dto: CreateWithdrawalDto) {
    const key = idempotencyKey.trim();
    if (key.length < 8 || key.length > 200) throw new BadRequestException('Idempotency-Key phải có từ 8 đến 200 ký tự');
    const amount = new Prisma.Decimal(dto.amount_vnd);
    if (!amount.isInteger() || amount.lessThanOrEqualTo(0)) throw new BadRequestException('Số tiền rút không hợp lệ');

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          const existing = await tx.withdrawal.findUnique({
            where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
          });
          if (existing) {
            this.assertSameCreateRequest(existing, dto, amount);
            return { row: existing, changed: false };
          }

          const debited = await tx.user.updateMany({
            where: { id: userId, status: UserStatus.ACTIVE, balanceVnd: { gte: amount } },
            data: { balanceVnd: { decrement: amount } },
          });
          if (debited.count !== 1) {
            const account = await tx.user.findUnique({ where: { id: userId }, select: { status: true, balanceVnd: true } });
            if (!account || account.status !== UserStatus.ACTIVE) throw new BadRequestException('Tài khoản không thể tạo lệnh rút');
            throw new BadRequestException('Số dư không đủ để tạo lệnh rút');
          }
          const account = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { balanceVnd: true } });
          const withdrawal = await tx.withdrawal.create({
            data: {
              userId,
              amountVnd: amount,
              bankName: dto.bank_name.trim(),
              bankAccountNumber: dto.bank_account_number.trim(),
              bankAccountName: dto.bank_account_name.trim().toUpperCase(),
              idempotencyKey: key,
              balanceBeforeVnd: account.balanceVnd.plus(amount),
              balanceAfterVnd: account.balanceVnd,
            },
          });
          await tx.ledgerEntry.create({
            data: {
              userId,
              amountVnd: amount,
              direction: 'DEBIT',
              description: `Giữ tiền cho lệnh rút ${withdrawal.id}`,
              withdrawalId: withdrawal.id,
            },
          });
          await tx.auditLog.create({
            data: { actorId: userId, action: 'WITHDRAWAL_CREATED', entityType: 'Withdrawal', entityId: withdrawal.id, metadata: { amountVnd: amount.toString() } },
          });
          return { row: withdrawal, changed: true };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        if (result.changed) await this.notifyTelegramCreated(result.row);
        return this.attachProof([result.row]).then(([row]) => row);
      } catch (error) {
        if (this.isPrismaError(error, 'P2002')) {
          const existing = await this.prisma.withdrawal.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: key } } });
          if (existing) {
            this.assertSameCreateRequest(existing, dto, amount);
            return this.attachProof([existing]).then(([row]) => row);
          }
        }
        if (this.isPrismaError(error, 'P2034') && attempt < 2) continue;
        throw error;
      }
    }
    throw new ConflictException('Không thể giữ số dư lúc này, vui lòng thử lại');
  }

  async mine(userId: string) {
    const rows = await this.prisma.withdrawal.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return this.attachProof(rows);
  }

  async myDetail(userId: string, id: string) {
    const row = await this.prisma.withdrawal.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('Không tìm thấy lệnh rút');
    return this.attachProof([row]).then(([item]) => item);
  }

  async adminList(status?: WithdrawalStatus) {
    const rows = await this.prisma.withdrawal.findMany({
      where: status ? { status } : {},
      include: {
        user: { select: { id: true, email: true, fullName: true, phone: true, balanceVnd: true } },
        reviewedBy: { select: { id: true, email: true, fullName: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return this.attachProof(rows);
  }

  async adminDetail(id: string) {
    const [row, history] = await Promise.all([
      this.prisma.withdrawal.findUnique({
        where: { id },
        include: {
          user: { select: { id: true, email: true, fullName: true, phone: true, balanceVnd: true } },
          reviewedBy: { select: { id: true, email: true, fullName: true, role: true } },
        },
      }),
      this.prisma.auditLog.findMany({
        where: { entityType: 'Withdrawal', entityId: id },
        include: { actor: { select: { id: true, email: true, fullName: true, role: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    if (!row) throw new NotFoundException('Không tìm thấy lệnh rút');
    const [item] = await this.attachProof([row]);
    return {
      ...item,
      history: history.map((event) => ({
        id: event.id,
        action: event.action,
        metadata: event.metadata,
        createdAt: event.createdAt,
        actor: event.actor,
      })),
    };
  }

  async approve(actorId: string, id: string, dto: ApproveWithdrawalDto) {
    const proof = await this.files.assertOwned(actorId, dto.transfer_proof_file_id);
    if (!proof.mimeType.startsWith('image/')) throw new BadRequestException('Ảnh chuyển khoản phải là JPG, PNG hoặc WebP');
    const transactionCode = dto.transaction_code.trim().toUpperCase();
    let result: { row: Withdrawal; changed: boolean };
    try {
      result = await this.serializable(async (tx) => {
        const current = await tx.withdrawal.findUnique({ where: { id } });
        if (!current) throw new NotFoundException('Không tìm thấy lệnh rút');
        if (current.status === WithdrawalStatus.APPROVED) return { row: current, changed: false };
        if (current.status === WithdrawalStatus.REJECTED) throw new BadRequestException('Lệnh rút đã bị từ chối');
        const updated = await tx.withdrawal.updateMany({
          where: { id, status: WithdrawalStatus.PENDING },
          data: {
            status: WithdrawalStatus.APPROVED,
            reviewedById: actorId,
            reviewedAt: new Date(),
            reviewNote: dto.review_note?.trim(),
            transferProofFileId: proof.id,
            bankTransactionCode: transactionCode,
          },
        });
        if (updated.count !== 1) return { row: await tx.withdrawal.findUniqueOrThrow({ where: { id } }), changed: false };
        await tx.auditLog.create({
          data: { actorId, action: 'WITHDRAWAL_APPROVED', entityType: 'Withdrawal', entityId: id, metadata: { transactionCode, proofFileId: proof.id } },
        });
        return { row: await tx.withdrawal.findUniqueOrThrow({ where: { id } }), changed: true };
      });
    } catch (error) {
      if (this.isPrismaError(error, 'P2002')) throw new BadRequestException('Mã giao dịch ngân hàng đã được sử dụng');
      throw error;
    }
    if (result.changed) {
      await this.notifyResult(result.row.userId, result.row.id, result.row.amountVnd, 'APPROVED');
      await this.notifyTelegramReviewed(actorId, result.row, 'APPROVED', transactionCode);
    }
    return this.attachProof([result.row]).then(([row]) => row);
  }

  async reject(actorId: string, id: string, dto: RejectWithdrawalDto) {
    const result = await this.serializable(async (tx) => {
      const current = await tx.withdrawal.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Không tìm thấy lệnh rút');
      if (current.status === WithdrawalStatus.REJECTED) return { row: current, changed: false };
      if (current.status === WithdrawalStatus.APPROVED) throw new BadRequestException('Lệnh rút đã được duyệt');
      const now = new Date();
      const updated = await tx.withdrawal.updateMany({
        where: { id, status: WithdrawalStatus.PENDING },
        data: {
          status: WithdrawalStatus.REJECTED,
          reviewedById: actorId,
          reviewedAt: now,
          rejectionReason: dto.reason.trim(),
          reviewNote: dto.reason.trim(),
          refundedAt: now,
        },
      });
      if (updated.count !== 1) return { row: await tx.withdrawal.findUniqueOrThrow({ where: { id } }), changed: false };
      await tx.user.update({ where: { id: current.userId }, data: { balanceVnd: { increment: current.amountVnd } } });
      await tx.ledgerEntry.create({
        data: {
          userId: current.userId,
          amountVnd: current.amountVnd,
          direction: 'CREDIT',
          description: `Hoàn tiền lệnh rút ${current.id}`,
          withdrawalId: current.id,
        },
      });
      await tx.auditLog.create({
        data: { actorId, action: 'WITHDRAWAL_REJECTED_REFUNDED', entityType: 'Withdrawal', entityId: id, metadata: { reason: dto.reason.trim(), amountVnd: current.amountVnd.toString() } },
      });
      return { row: await tx.withdrawal.findUniqueOrThrow({ where: { id } }), changed: true };
    });
    if (result.changed) {
      await this.notifyResult(result.row.userId, result.row.id, result.row.amountVnd, 'REJECTED', dto.reason.trim());
      await this.notifyTelegramReviewed(actorId, result.row, 'REJECTED', undefined, dto.reason.trim());
    }
    return this.attachProof([result.row]).then(([row]) => row);
  }

  private async serializable<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (this.isPrismaError(error, 'P2034') && attempt < 2) continue;
        throw error;
      }
    }
    throw new ConflictException('Dữ liệu đang được xử lý, vui lòng thử lại');
  }

  private async attachProof<T extends { transferProofFileId: string | null; amountVnd: Prisma.Decimal; balanceBeforeVnd: Prisma.Decimal; balanceAfterVnd: Prisma.Decimal }>(rows: T[]) {
    const ids = [...new Set(rows.map((row) => row.transferProofFileId).filter((id): id is string => Boolean(id)))];
    const files = ids.length ? await this.prisma.fileUpload.findMany({ where: { id: { in: ids } } }) : [];
    const byId = new Map(files.map((file) => [file.id, this.files.view(file)]));
    return rows.map((row) => ({
      ...row,
      amountVnd: row.amountVnd.toString(),
      balanceBeforeVnd: row.balanceBeforeVnd.toString(),
      balanceAfterVnd: row.balanceAfterVnd.toString(),
      transferProof: row.transferProofFileId ? byId.get(row.transferProofFileId) ?? null : null,
    }));
  }

  private async notifyResult(userId: string, withdrawalId: string, amount: Prisma.Decimal, status: 'APPROVED' | 'REJECTED', reason?: string) {
    try {
      await this.push.notifyWithdrawalResult(userId, { withdrawalId, amountVnd: amount.toString(), status, reason });
    } catch (error) {
      this.logger.warn(`Không gửi được thông báo lệnh rút ${withdrawalId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async notifyTelegramCreated(row: Withdrawal) {
    if (!this.telegram.isConfigured()) return;
    const customer = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: { fullName: true, email: true },
    });
    if (!customer) return;
    await this.telegram.notifyWithdrawalCreated({
      id: row.id,
      amountVnd: row.amountVnd.toString(),
      customerName: customer.fullName,
      customerEmail: customer.email,
      bankName: row.bankName,
      bankAccountNumber: row.bankAccountNumber,
      bankAccountName: row.bankAccountName,
    });
  }

  private async notifyTelegramReviewed(
    actorId: string,
    row: Withdrawal,
    status: 'APPROVED' | 'REJECTED',
    transactionCode?: string,
    reason?: string,
  ) {
    if (!this.telegram.isConfigured()) return;
    const [customer, reviewer] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: row.userId }, select: { fullName: true, email: true } }),
      this.prisma.user.findUnique({ where: { id: actorId }, select: { fullName: true, email: true } }),
    ]);
    if (!customer || !reviewer) return;
    await this.telegram.notifyWithdrawalReviewed({
      id: row.id,
      amountVnd: row.amountVnd.toString(),
      customerName: customer.fullName,
      customerEmail: customer.email,
      bankName: row.bankName,
      bankAccountNumber: row.bankAccountNumber,
      bankAccountName: row.bankAccountName,
      status,
      reviewerName: reviewer.fullName,
      reviewerEmail: reviewer.email,
      transactionCode,
      reason,
    });
  }

  private assertSameCreateRequest(existing: Withdrawal, dto: CreateWithdrawalDto, amount: Prisma.Decimal) {
    const samePayload = existing.amountVnd.equals(amount)
      && existing.bankName === dto.bank_name.trim()
      && existing.bankAccountNumber === dto.bank_account_number.trim()
      && existing.bankAccountName === dto.bank_account_name.trim().toUpperCase();
    if (!samePayload) throw new ConflictException('Idempotency-Key đã được dùng cho một lệnh rút khác');
  }

  private isPrismaError(error: unknown, code: string) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
  }
}
