import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ArticleStatus, DepositStatus, OrderStatus, Prisma, ReviewStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../common/prisma.module';
import { normalizePhone } from '../common/identity.util';
import { userView } from '../auth/auth.service';
import { FileStorageService } from './file-storage.service';
import { CreateArticleDto, CreateDepositDto, CreateKycDto, CreateNftProductDto, ReviewDto, VietQrCallbackDto } from './phase1.dto';
import { requireAvailableSupply } from './domain';
import { generateNumericOrderId, VietQrService } from './vietqr.service';

@Injectable()
export class Phase1Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly files: FileStorageService,
    private readonly vietQr: VietQrService,
  ) {}

  async createKyc(userId: string, dto: CreateKycDto) {
    const pending = await this.prisma.kycSubmission.findFirst({ where: { userId, status: ReviewStatus.PENDING } });
    if (pending) throw new BadRequestException('Đã có hồ sơ KYC đang chờ duyệt');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (dto.email && dto.email.trim().toLowerCase() !== user.email) {
      throw new BadRequestException('Email KYC phải trùng với email tài khoản');
    }
    const front = dto.id_front_file_id ?? dto.id_front_file_url;
    const back = dto.id_back_file_id ?? dto.id_back_file_url;
    const selfie = dto.selfie_file_id ?? dto.selfie_file_url;
    if (!front || !back || !selfie) throw new BadRequestException('Cần tải lên mặt trước, mặt sau và ảnh selfie cầm CCCD');
    for (const fileId of [dto.id_front_file_id, dto.id_back_file_id, dto.selfie_file_id]) {
      if (!fileId) continue;
      const file = await this.files.assertOwned(userId, fileId);
      if (!file.mimeType.startsWith('image/')) throw new BadRequestException('Ảnh KYC phải là JPG, PNG hoặc WebP');
    }
    const dateOfBirth = dto.date_of_birth === undefined
      ? undefined
      : new Date(typeof dto.date_of_birth === 'number' ? dto.date_of_birth : dto.date_of_birth);
    if (dateOfBirth && Number.isNaN(dateOfBirth.getTime())) throw new BadRequestException('Ngày sinh không hợp lệ');
    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const submission = await tx.kycSubmission.create({
          data: {
            userId,
            fullName: dto.full_name.trim(),
            dateOfBirth,
            idCardNumber: dto.id_card_number?.trim(),
            phoneNumber: dto.phone_number.trim(),
            address: dto.address.trim(),
            bankAccountName: dto.bank_account_name.trim(),
            bankAccountNumber: dto.bank_account_number.trim(),
            bankName: dto.bank_name.trim(),
            idFrontFileUrl: front,
            idBackFileUrl: back,
            selfieFileUrl: selfie,
          },
        });
        await tx.user.update({
          where: { id: userId },
          data: {
            fullName: dto.full_name.trim(),
            nickname: dto.full_name.trim(),
            phone: dto.phone_number.trim(),
            phoneNormalized: normalizePhone(dto.phone_number),
            address: dto.address.trim(),
            bankAccountName: dto.bank_account_name.trim(),
            bankAccountNumber: dto.bank_account_number.trim(),
            bankName: dto.bank_name.trim(),
          },
        });
        return submission;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('Số điện thoại đã được sử dụng bởi tài khoản khác');
      }
      throw error;
    }
    return this.withKycFiles(created);
  }

  async getMyKyc(userId: string) {
    const row = await this.prisma.kycSubmission.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return row ? this.withKycFiles(row) : null;
  }

  async listKyc(status?: ReviewStatus) {
    const rows = await this.prisma.kycSubmission.findMany({ where: status ? { status } : {}, include: { user: true }, orderBy: { createdAt: 'desc' } });
    return Promise.all(rows.map((row) => this.withKycFiles(row)));
  }

  async reviewKyc(actorId: string, id: string, dto: ReviewDto) {
    if (dto.status === ReviewStatus.PENDING) throw new BadRequestException('Trạng thái duyệt không hợp lệ');
    if (dto.status === ReviewStatus.REJECTED && !dto.rejection_reason) throw new BadRequestException('Cần nhập lý do từ chối');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.kycSubmission.findUniqueOrThrow({ where: { id } });
        if (current.status !== ReviewStatus.PENDING) return current;
        const reviewed = await tx.kycSubmission.update({
          where: { id },
          data: { status: dto.status, reviewNote: dto.review_note, rejectionReason: dto.rejection_reason, reviewedAt: new Date(), reviewedById: actorId },
        });
        if (dto.status === ReviewStatus.APPROVED) {
          await tx.user.update({
            where: { id: current.userId },
            data: {
              kycVerifiedAt: new Date(),
              fullName: current.fullName,
              nickname: current.fullName,
              phone: current.phoneNumber,
              phoneNormalized: normalizePhone(current.phoneNumber),
              address: current.address,
              bankAccountName: current.bankAccountName,
              bankAccountNumber: current.bankAccountNumber,
              bankName: current.bankName,
            },
          });
        }
        await tx.auditLog.create({ data: { actorId, action: `KYC_${dto.status}`, entityType: 'KycSubmission', entityId: id, metadata: { reviewNote: dto.review_note } } });
        return reviewed;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('Số điện thoại đã được sử dụng bởi tài khoản khác');
      }
      throw error;
    }
  }

  async createDeposit(userId: string, dto: CreateDepositDto, idempotencyKey: string) {
    const existing = await this.prisma.deposit.findUnique({ where: { idempotencyKey } });
    if (existing) return this.depositView(existing);
    const amount = new Prisma.Decimal(dto.amount_vnd);
    if (amount.lessThan(10_000)) throw new BadRequestException('Số tiền nạp tối thiểu là 10.000 VND');
    if (amount.greaterThan(Number.MAX_SAFE_INTEGER)) throw new BadRequestException('Số tiền nạp vượt giới hạn hỗ trợ');
    const transferCode = `MI${Date.now().toString(36).toUpperCase()}`;
    const vietQrOrderId = generateNumericOrderId();
    const qr = await this.vietQr.generate(amount.toNumber(), transferCode, vietQrOrderId);
    const created = await this.prisma.deposit.create({
      data: {
        userId,
        amountVnd: amount,
        transferCode,
        proofFileUrl: dto.proof_file_url,
        idempotencyKey,
        vietQrOrderId: qr.order_id,
        qrCodeUrl: qr.qr_code,
        vietQrData: qr as unknown as Prisma.InputJsonValue,
      },
    });
    return this.depositView(created);
  }

  async listDeposits(userId?: string, status?: DepositStatus) {
    const rows = await this.prisma.deposit.findMany({ where: { ...(userId ? { userId } : {}), ...(status ? { status } : {}) }, include: { user: true }, orderBy: { createdAt: 'desc' } });
    return rows.map((row) => this.depositView(row));
  }

  async syncVietQrPayment(dto: VietQrCallbackDto) {
    if (dto.transType.toUpperCase() !== 'C') throw new BadRequestException('Chỉ chấp nhận giao dịch tiền vào');
    const configuredAccount = process.env.VIETQR_BANK_ACCOUNT;
    if (configuredAccount && dto.bankaccount !== configuredAccount) throw new BadRequestException('Tài khoản nhận tiền không hợp lệ');

    return this.prisma.$transaction(async (tx) => {
      let deposit = dto.orderId ? await tx.deposit.findUnique({ where: { vietQrOrderId: dto.orderId } }) : null;
      if (!deposit) deposit = await tx.deposit.findUnique({ where: { transferCode: dto.content.trim() } });
      if (!deposit) {
        const recent = await tx.deposit.findMany({
          where: { status: { in: [DepositStatus.PENDING, DepositStatus.CONFIRMED] } },
          orderBy: { createdAt: 'desc' },
          take: 200,
        });
        const normalizedContent = dto.content.toUpperCase();
        deposit = recent.find((candidate) => normalizedContent.includes(candidate.transferCode.toUpperCase())) ?? null;
      }
      if (!deposit) throw new NotFoundException('Không tìm thấy lệnh nạp VietQR');
      if (deposit.status === DepositStatus.CONFIRMED) {
        if (deposit.bankTransactionId === dto.transactionid) return this.depositView(deposit);
        throw new BadRequestException('Lệnh nạp đã được thanh toán');
      }
      if (deposit.status !== DepositStatus.PENDING) throw new BadRequestException('Lệnh nạp không còn chờ thanh toán');
      const paidAmount = new Prisma.Decimal(dto.amount);
      if (paidAmount.lessThan(deposit.amountVnd)) throw new BadRequestException('Số tiền chuyển khoản chưa đủ');
      const user = await tx.user.findUniqueOrThrow({ where: { id: deposit.userId } });
      const balanceAfter = user.balanceVnd.plus(deposit.amountVnd);

      const updated = await tx.deposit.update({
        where: { id: deposit.id },
        data: {
          status: DepositStatus.CONFIRMED,
          bankTransactionId: dto.transactionid,
          bankReferenceNumber: dto.referencenumber,
          paidAmountVnd: paidAmount,
          paidAt: dto.transactiontime ? new Date(dto.transactiontime > 1_000_000_000_000 ? dto.transactiontime : dto.transactiontime * 1000) : new Date(),
          balanceBeforeVnd: user.balanceVnd,
          balanceAfterVnd: balanceAfter,
          reviewedAt: new Date(),
          reviewNote: 'Xác nhận tự động qua webhook VietQR',
        },
      });
      await tx.user.update({ where: { id: deposit.userId }, data: { balanceVnd: balanceAfter } });
      await tx.ledgerEntry.create({
        data: { userId: deposit.userId, amountVnd: deposit.amountVnd, direction: 'CREDIT', description: `VietQR ${deposit.transferCode}`, depositId: deposit.id },
      });
      await tx.auditLog.create({
        data: {
          actorId: null,
          action: 'VIETQR_DEPOSIT_CONFIRMED',
          entityType: 'Deposit',
          entityId: deposit.id,
          metadata: { transactionId: dto.transactionid, referenceNumber: dto.referencenumber, paidAmount: paidAmount.toString() },
        },
      });
      return this.depositView(updated);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  confirmDeposit(actorId: string, id: string, note?: string) {
    return this.prisma.$transaction(async (tx) => {
      const deposit = await tx.deposit.findUniqueOrThrow({ where: { id } });
      if (deposit.status === DepositStatus.CONFIRMED) return deposit;
      if (deposit.status !== DepositStatus.PENDING) throw new BadRequestException('Lệnh nạp không còn chờ xử lý');
      const user = await tx.user.findUniqueOrThrow({ where: { id: deposit.userId } });
      const balanceAfter = user.balanceVnd.plus(deposit.amountVnd);
      const updated = await tx.deposit.update({
        where: { id },
        data: {
          status: DepositStatus.CONFIRMED,
          reviewedAt: new Date(),
          reviewedById: actorId,
          reviewNote: note,
          balanceBeforeVnd: user.balanceVnd,
          balanceAfterVnd: balanceAfter,
        },
      });
      await tx.user.update({ where: { id: deposit.userId }, data: { balanceVnd: balanceAfter } });
      await tx.ledgerEntry.create({ data: { userId: deposit.userId, amountVnd: deposit.amountVnd, direction: 'CREDIT', description: `Nạp tiền ${deposit.transferCode}`, depositId: deposit.id } });
      await tx.auditLog.create({ data: { actorId, action: 'DEPOSIT_CONFIRMED', entityType: 'Deposit', entityId: id, metadata: { amountVnd: deposit.amountVnd.toString() } } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async rejectDeposit(actorId: string, id: string, note?: string) {
    const deposit = await this.prisma.deposit.findUniqueOrThrow({ where: { id } });
    if (deposit.status !== DepositStatus.PENDING) return deposit;
    const updated = await this.prisma.deposit.update({ where: { id }, data: { status: DepositStatus.REJECTED, reviewedAt: new Date(), reviewedById: actorId, reviewNote: note } });
    await this.prisma.auditLog.create({ data: { actorId, action: 'DEPOSIT_REJECTED', entityType: 'Deposit', entityId: id } });
    return updated;
  }

  listProducts(activeOnly = true) {
    return this.prisma.nftProduct.findMany({ where: activeOnly ? { isActive: true } : {}, orderBy: { createdAt: 'desc' } });
  }

  createProduct(dto: CreateNftProductDto) {
    return this.prisma.nftProduct.create({
      data: { name: dto.name, symbol: dto.symbol, description: dto.description, imageUrl: dto.image_url, metadataBaseUrl: dto.metadata_base_url, unitPriceVnd: new Prisma.Decimal(dto.unit_price_vnd), totalSupply: dto.total_supply },
    });
  }

  async calculatePrice(productId: string, quantity: number) {
    const product = await this.prisma.nftProduct.findUnique({ where: { id: productId } });
    if (!product?.isActive) throw new NotFoundException('NFT không tồn tại');
    requireAvailableSupply(product.totalSupply, product.soldCount, quantity);
    return { amount: quantity, nft_id: product.id, price_nft: product.unitPriceVnd.toString(), total_vnd: product.unitPriceVnd.mul(quantity).toString() };
  }

  async createSnapshot(userId: string, productId: string, quantity: number, paymentType: string) {
    const price = await this.calculatePrice(productId, quantity);
    const jti = `${userId}:${productId}:${Date.now()}`;
    const snapshot = await this.jwt.signAsync({ ...price, sub: userId, payment_type: paymentType, jti }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '10m' });
    return { ...price, price_snapshot: snapshot, expires_in: 600 };
  }

  async purchase(userId: string, snapshot: string, agencyCode?: string) {
    let quote: { sub: string; nft_id: string; amount: number; price_nft: string; total_vnd: string; jti: string };
    try { quote = await this.jwt.verifyAsync(snapshot, { secret: process.env.JWT_ACCESS_SECRET }); }
    catch { throw new BadRequestException('Báo giá không hợp lệ hoặc đã hết hạn'); }
    if (quote.sub !== userId) throw new BadRequestException('Báo giá không thuộc người dùng hiện tại');
    const idempotencyKey = `snapshot:${quote.jti}`;
    const existing = await this.prisma.purchaseOrder.findUnique({ where: { idempotencyKey }, include: { nftAssets: true } });
    if (existing) return existing;

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const product = await tx.nftProduct.findUniqueOrThrow({ where: { id: quote.nft_id } });
      const total = new Prisma.Decimal(quote.total_vnd);
      if (!user.kycVerifiedAt) throw new BadRequestException('Cần hoàn tất KYC trước khi mua NFT');
      if (user.balanceVnd.lessThan(total)) throw new BadRequestException('Số dư không đủ');
      requireAvailableSupply(product.totalSupply, product.soldCount, quote.amount);
      const agency = agencyCode ? await tx.agency.findUnique({
        where: { code: agencyCode.toUpperCase() },
        include: { store: true, packages: { where: { status: 'ACTIVE', remainingCommissionSlots: { gt: 0 } }, orderBy: { createdAt: 'desc' }, take: 1 } },
      }) : null;
      if (agencyCode && (!agency || agency.status !== 'APPROVED' || !agency.store?.isActive)) throw new BadRequestException('Mã đại lý không hợp lệ hoặc đã bị khóa');
      if (agency?.userId === userId) throw new BadRequestException('Đại lý không thể tự nhận hoa hồng cho đơn của mình');
      const activePackage = agency?.packages[0];
      const commissionRate = activePackage?.discountRate;
      const commissionVnd = commissionRate ? total.mul(commissionRate).toDecimalPlaces(0) : undefined;
      const created = await tx.purchaseOrder.create({
        data: {
          userId,
          productId: product.id,
          quantity: quote.amount,
          unitPriceVnd: new Prisma.Decimal(quote.price_nft),
          totalVnd: total,
          idempotencyKey,
          status: OrderStatus.COMPLETED,
          agencyId: activePackage ? agency?.id : undefined,
          commissionRate,
          commissionVnd,
        },
      });
      if (activePackage) {
        await tx.agencyPackagePurchase.update({
          where: { id: activePackage.id },
          data: {
            remainingCommissionSlots: { decrement: 1 },
            status: activePackage.remainingCommissionSlots === 1 ? 'EXHAUSTED' : undefined,
          },
        });
      }
      await tx.user.update({ where: { id: userId }, data: { balanceVnd: { decrement: total } } });
      await tx.nftProduct.update({ where: { id: product.id }, data: { soldCount: { increment: quote.amount } } });
      await tx.ledgerEntry.create({ data: { userId, amountVnd: total, direction: 'DEBIT', description: `Mua ${quote.amount} ${product.name}`, orderId: created.id } });
      const assets = Array.from({ length: quote.amount }, (_, index) => ({
        assetCode: `MINDO-${created.id}-${String(index + 1).padStart(4, '0')}`.toUpperCase(),
        metadataUrl: `${product.metadataBaseUrl.replace(/\/$/, '')}/${created.id}-${index + 1}.json`,
        ownerId: userId,
        productId: product.id,
        orderId: created.id,
      }));
      await tx.nftAsset.createMany({ data: assets });

      if (created.agencyId && agency && created.commissionVnd && created.commissionRate) {
        const commission = await tx.agencyCommission.create({
          data: { agencyId: created.agencyId, orderId: created.id, buyerId: userId, amountVnd: created.commissionVnd, rate: created.commissionRate },
        });
        await tx.agency.update({
          where: { id: created.agencyId },
          data: { totalRevenueVnd: { increment: total }, totalCommissionVnd: { increment: created.commissionVnd } },
        });
        await tx.user.update({ where: { id: agency.userId }, data: { balanceVnd: { increment: created.commissionVnd } } });
        await tx.ledgerEntry.create({
          data: { userId: agency.userId, amountVnd: created.commissionVnd, direction: 'CREDIT', description: `Hoa hồng đại lý đơn ${created.id}`, commissionId: commission.id },
        });
      }

      await tx.auditLog.create({
        data: { actorId: userId, action: 'NFT_INTERNAL_ISSUED', entityType: 'PurchaseOrder', entityId: created.id, metadata: { quantity: quote.amount, productId: product.id } },
      });
      return tx.purchaseOrder.findUniqueOrThrow({ where: { id: created.id }, include: { nftAssets: true } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  myNfts(userId: string, productId?: string) {
    return this.prisma.nftAsset.findMany({ where: { ownerId: userId, ...(productId ? { productId } : {}) }, include: { product: true }, orderBy: { issuedAt: 'desc' } });
  }

  transactions(userId?: string) {
    return this.prisma.purchaseOrder.findMany({ where: userId ? { userId } : {}, include: { user: true, product: true, nftAssets: true }, orderBy: { createdAt: 'desc' } });
  }

  articles(publishedOnly = true) {
    return this.prisma.newsArticle.findMany({ where: publishedOnly ? { status: ArticleStatus.PUBLISHED } : {}, orderBy: { publishedAt: 'desc' } });
  }

  createArticle(dto: CreateArticleDto) {
    return this.prisma.newsArticle.create({ data: { title: dto.title, slug: dto.slug, summary: dto.summary, content: dto.content, imageUrl: dto.image_url, sourceUrl: dto.source_url, status: dto.status, publishedAt: dto.status === ArticleStatus.PUBLISHED ? new Date() : undefined } });
  }

  async dashboard() {
    const [kycPending, depositsPending, sold, ordersNeedReview] = await Promise.all([
      this.prisma.kycSubmission.count({ where: { status: ReviewStatus.PENDING } }),
      this.prisma.deposit.count({ where: { status: DepositStatus.PENDING } }),
      this.prisma.nftAsset.count(),
      this.prisma.purchaseOrder.count({ where: { status: { in: [OrderStatus.PENDING, OrderStatus.FAILED] } } }),
    ]);
    return { kyc_pending: kycPending, deposits_pending: depositsPending, nft_sold: sold, transactions_need_review: ordersNeedReview };
  }

  async users() {
    const users = await this.prisma.user.findMany({ where: { role: UserRole.INVESTOR }, orderBy: { createdAt: 'desc' } });
    return users.map(userView);
  }

  private depositView<T extends { vietQrData: Prisma.JsonValue | null }>(deposit: T) {
    return { ...deposit, vietqr: deposit.vietQrData };
  }

  private async withKycFiles<T extends { idFrontFileUrl: string; idBackFileUrl: string; selfieFileUrl?: string | null }>(row: T) {
    const ids = [row.idFrontFileUrl, row.idBackFileUrl, row.selfieFileUrl].filter((id): id is string => Boolean(id));
    const files = await this.prisma.fileUpload.findMany({ where: { id: { in: ids } } });
    const byId = new Map(files.map((file) => [file.id, this.files.view(file)]));
    const front = byId.get(row.idFrontFileUrl);
    const back = byId.get(row.idBackFileUrl);
    const selfie = row.selfieFileUrl ? byId.get(row.selfieFileUrl) : undefined;
    return {
      ...row,
      idFrontFileUrl: front?.public_url ?? row.idFrontFileUrl,
      idBackFileUrl: back?.public_url ?? row.idBackFileUrl,
      id_front_file_id: front?.id ?? row.idFrontFileUrl,
      id_back_file_id: back?.id ?? row.idBackFileUrl,
      id_front_file: front,
      id_back_file: back,
      selfieFileUrl: selfie?.public_url ?? row.selfieFileUrl,
      selfie_file_id: selfie?.id ?? row.selfieFileUrl,
      selfie_file: selfie,
    };
  }
}
