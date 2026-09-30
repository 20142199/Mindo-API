import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ArticleStatus, DepositStatus, OrderStatus, Prisma, ReviewStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../common/prisma.module';
import { normalizePhone } from '../common/identity.util';
import { userView } from '../auth/auth.service';
import { FileStorageService } from './file-storage.service';
import { CreateArticleDto, CreateDepositDto, CreateKycDto, CreateNftProductDto, ReviewDto, UpdateNftProductDto, VietQrCallbackDto } from './phase1.dto';
import { requireAvailableSupply } from './domain';
import { generateNumericOrderId, VietQrService } from './vietqr.service';
import { ReferralService } from '../referral/referral.service';
import { agencyTiers, priceAgencyPackages } from '../phase2/phase2.domain';
import { isReferralCodeShape } from '../referral/referral.domain';
import { pageExtra } from '../common/api-response';

type SignedPurchaseQuote = {
  sub: string;
  jti: string;
  payment_type: string;
  amount: number;
  nft_id: string;
  price_nft: string;
  total_vnd: string;
  gross_total_vnd: string;
  discount_vnd: string;
  effective_discount_rate: number;
  agency_title: string;
  agency_title_label: string;
  unit_price_usd: string;
  usd_vnd_rate: string;
  starting_package_number: number;
  ending_package_number: number;
  pricing_breakdown: Array<Record<string, unknown>>;
  referral_code: string | null;
  referrer_id: string | null;
  agency_id: string | null;
};

@Injectable()
export class Phase1Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly files: FileStorageService,
    private readonly vietQr: VietQrService,
    private readonly referrals: ReferralService,
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
    const rows = await this.prisma.kycSubmission.findMany({
      where: status ? { status } : {},
      include: { user: { select: { id: true, email: true, fullName: true, phone: true, referralCode: true } } },
      orderBy: { createdAt: 'desc' },
    });
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
    const qrTtlMinutes = Math.min(60, Math.max(5, Number(process.env.VIETQR_QR_TTL_MINUTES ?? 15)));
    const expiresAt = new Date(Date.now() + qrTtlMinutes * 60_000);
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
        expiresAt,
      },
    });
    return this.depositView(created);
  }

  /** Người dùng tự huỷ lệnh nạp đang chờ. Tiền về sau khi huỷ vẫn được webhook cộng. */
  async cancelDeposit(userId: string, id: string) {
    const deposit = await this.prisma.deposit.findFirst({ where: { id, userId } });
    if (!deposit) throw new NotFoundException('Không tìm thấy lệnh nạp');
    if (deposit.status === DepositStatus.CANCELLED) return this.depositView(deposit);
    if (deposit.status !== DepositStatus.PENDING) throw new ConflictException('Lệnh nạp đã được xử lý, không thể huỷ');
    const updated = await this.prisma.deposit.update({
      where: { id },
      data: { status: DepositStatus.CANCELLED, reviewedAt: new Date(), reviewNote: 'Người dùng huỷ' },
    });
    await this.prisma.auditLog.create({ data: { actorId: userId, action: 'DEPOSIT_CANCELLED', entityType: 'Deposit', entityId: id } });
    return this.depositView(updated);
  }

  async listDeposits(userId?: string, status?: DepositStatus) {
    const rows = await this.prisma.deposit.findMany({
      where: { ...(userId ? { userId } : {}), ...(status ? { status } : {}) },
      include: { user: { select: { id: true, email: true, fullName: true, phone: true, balanceVnd: true } } },
      orderBy: { createdAt: 'desc' },
    });
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
          where: { status: { in: [DepositStatus.PENDING, DepositStatus.CONFIRMED, DepositStatus.CANCELLED] } },
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
      // Lệnh đã huỷ vẫn nhận tiền: khách có thể chuyển khoản xong rồi mới bấm huỷ.
      const cancelled = deposit.status === DepositStatus.CANCELLED;
      if (deposit.status !== DepositStatus.PENDING && !cancelled) throw new BadRequestException('Lệnh nạp không còn chờ thanh toán');
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
          reviewNote: cancelled ? 'Xác nhận tự động qua webhook VietQR (tiền về sau khi lệnh đã huỷ)' : 'Xác nhận tự động qua webhook VietQR',
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

  listProducts(activeOnly = true) {
    return this.prisma.nftProduct.findMany({ where: activeOnly ? { isActive: true } : {}, orderBy: { createdAt: 'desc' } });
  }

  async productDetail(id: string) {
    const product = await this.prisma.nftProduct.findFirst({ where: { id, isActive: true } });
    if (!product) throw new NotFoundException('NFT không tồn tại');
    return {
      ...product,
      available_supply: Math.max(0, product.totalSupply - product.soldCount),
      ownership_system: 'MINDO_INTERNAL',
      blockchain_transaction: null,
      transaction_fee_vnd: '0',
    };
  }

  createProduct(dto: CreateNftProductDto) {
    return this.prisma.nftProduct.create({
      data: { name: dto.name, symbol: dto.symbol, description: dto.description, imageUrl: dto.image_url, metadataBaseUrl: dto.metadata_base_url, unitPriceVnd: new Prisma.Decimal(dto.unit_price_vnd), totalSupply: dto.total_supply },
    });
  }

  async updateProduct(id: string, dto: UpdateNftProductDto) {
    const current = await this.prisma.nftProduct.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Peer không tồn tại');
    if (dto.total_supply !== undefined && dto.total_supply < current.soldCount) {
      throw new BadRequestException(`Nguồn cung không thể thấp hơn ${current.soldCount} Peer đã bán`);
    }
    return this.prisma.nftProduct.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        symbol: dto.symbol?.trim().toUpperCase(),
        description: dto.description?.trim(),
        imageUrl: dto.image_url,
        metadataBaseUrl: dto.metadata_base_url,
        unitPriceVnd: dto.unit_price_vnd === undefined ? undefined : new Prisma.Decimal(dto.unit_price_vnd),
        totalSupply: dto.total_supply,
        isActive: dto.is_active,
      },
    });
  }

  async purchaseConfig(userId: string, productId?: string) {
    const [user, settings, product] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.packageSettings(),
      productId
        ? this.prisma.nftProduct.findFirst({ where: { id: productId, isActive: true } })
        : this.prisma.nftProduct.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } }),
    ]);
    if (!product) throw new NotFoundException('NFT không tồn tại');
    const unitPriceVnd = settings.basePriceUsd.mul(settings.usdVndRate).toDecimalPlaces(0);
    return {
      product: await this.productDetail(product.id),
      base_price_usd: settings.basePriceUsd.toString(),
      usd_vnd_rate: settings.usdVndRate.toString(),
      unit_price_vnd: unitPriceVnd.toString(),
      max_quantity_per_order: 500,
      current_title: user.agencyTitle,
      total_packages_purchased: user.totalPackagesPurchased,
      balance_vnd: user.balanceVnd.toString(),
      kyc_verified: Boolean(user.kycVerifiedAt),
      tiers: agencyTiers.map((tier) => ({
        code: tier.code,
        title: tier.label,
        from_package: tier.fromPackage,
        to_package: tier.toPackage,
        discount_percent: tier.discountRate * 100,
      })),
      updated_at: settings.updatedAt,
    };
  }

  async calculatePrice(userId: string, productId: string, quantity: number, referralCode?: string) {
    const quote = await this.buildPurchaseQuote(userId, productId, quantity, referralCode);
    const { referrer_id: _referrerId, agency_id: _agencyId, ...publicQuote } = quote;
    return publicQuote;
  }

  async createSnapshot(userId: string, productId: string, quantity: number, paymentType: string, referralCode?: string) {
    if (paymentType.toUpperCase() !== 'BALANCE') throw new BadRequestException('Hiện chỉ hỗ trợ thanh toán bằng số dư Mindo');
    const price = await this.buildPurchaseQuote(userId, productId, quantity, referralCode);
    const jti = `${userId}:${productId}:${Date.now()}`;
    const signedQuote: SignedPurchaseQuote = { ...price, sub: userId, payment_type: 'BALANCE', jti };
    const snapshot = await this.jwt.signAsync(signedQuote, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '10m' });
    const { referrer_id: _referrerId, agency_id: _agencyId, ...publicPrice } = price;
    return { ...publicPrice, price_snapshot: snapshot, expires_in: 600 };
  }

  async purchase(userId: string, snapshot: string, legacyAgencyCode?: string, submittedReferralCode?: string) {
    let quote: SignedPurchaseQuote;
    try { quote = await this.jwt.verifyAsync(snapshot, { secret: process.env.JWT_ACCESS_SECRET }); }
    catch { throw new BadRequestException('Báo giá không hợp lệ hoặc đã hết hạn'); }
    if (quote.sub !== userId) throw new BadRequestException('Báo giá không thuộc người dùng hiện tại');
    if (submittedReferralCode && submittedReferralCode.toUpperCase() !== (quote.referral_code ?? '').toUpperCase()) {
      throw new BadRequestException('Mã giới thiệu không khớp với báo giá');
    }
    const idempotencyKey = `snapshot:${quote.jti}`;
    const existing = await this.prisma.purchaseOrder.findUnique({ where: { idempotencyKey }, include: { nftAssets: true } });
    if (existing) return this.purchaseOrderView(existing);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const product = await tx.nftProduct.findUniqueOrThrow({ where: { id: quote.nft_id } });
      const total = new Prisma.Decimal(quote.total_vnd);
      if (!user.kycVerifiedAt) throw new BadRequestException('Cần hoàn tất KYC trước khi mua NFT');
      if (user.balanceVnd.lessThan(total)) throw new BadRequestException('Số dư không đủ');
      if (user.totalPackagesPurchased + 1 !== quote.starting_package_number) {
        throw new BadRequestException('Danh hiệu hoặc số lượng sở hữu đã thay đổi, vui lòng lấy báo giá mới');
      }
      requireAvailableSupply(product.totalSupply, product.soldCount, quote.amount);
      const agencyCode = quote.agency_id ? null : legacyAgencyCode;
      const agency = quote.agency_id ? await tx.agency.findUnique({
        where: { id: quote.agency_id },
        include: { store: true, packages: { where: { status: 'ACTIVE', remainingCommissionSlots: { gt: 0 } }, orderBy: { createdAt: 'asc' }, take: 1 } },
      }) : agencyCode ? await tx.agency.findUnique({
        where: { code: agencyCode.toUpperCase() },
        include: { store: true, packages: { where: { status: 'ACTIVE', remainingCommissionSlots: { gt: 0 } }, orderBy: { createdAt: 'asc' }, take: 1 } },
      }) : null;
      if (agencyCode && (!agency || agency.status !== 'APPROVED' || !agency.store?.isActive)) throw new BadRequestException('Mã đại lý không hợp lệ hoặc đã bị khóa');
      if (agency?.userId === userId) throw new BadRequestException('Đại lý không thể tự nhận hoa hồng cho đơn của mình');
      const activePackage = agency?.packages[0];
      const commissionRate = activePackage && agency?.discountRate.greaterThan(0) ? agency.discountRate : undefined;
      const commissionVnd = commissionRate ? total.mul(commissionRate).toDecimalPlaces(0) : undefined;
      const created = await tx.purchaseOrder.create({
        data: {
          userId,
          productId: product.id,
          quantity: quote.amount,
          unitPriceVnd: new Prisma.Decimal(quote.price_nft),
          totalVnd: total,
          grossTotalVnd: new Prisma.Decimal(quote.gross_total_vnd),
          discountVnd: new Prisma.Decimal(quote.discount_vnd),
          effectiveDiscountRate: new Prisma.Decimal(quote.effective_discount_rate),
          agencyTitle: quote.agency_title,
          unitPriceUsd: new Prisma.Decimal(quote.unit_price_usd),
          usdVndRate: new Prisma.Decimal(quote.usd_vnd_rate),
          pricingBreakdown: quote.pricing_breakdown as Prisma.InputJsonValue,
          referralCode: quote.referral_code,
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
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          balanceVnd: { decrement: total },
          totalPackagesPurchased: quote.ending_package_number,
          agencyTitle: quote.agency_title,
          referredById: quote.referrer_id && !user.referredById ? quote.referrer_id : undefined,
        },
      });
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

      await this.referrals.applyPurchaseCommissions(tx, created, user, quote.referrer_id);

      await tx.auditLog.create({
        data: { actorId: userId, action: 'NFT_INTERNAL_ISSUED', entityType: 'PurchaseOrder', entityId: created.id, metadata: { quantity: quote.amount, productId: product.id } },
      });
      const order = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: created.id }, include: { product: true, nftAssets: true } });
      return this.purchaseOrderView(order, updatedUser.balanceVnd.toString());
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  myNfts(userId: string, productId?: string) {
    return this.prisma.nftAsset.findMany({ where: { ownerId: userId, ...(productId ? { productId } : {}) }, include: { product: true }, orderBy: { issuedAt: 'desc' } });
  }

  async myNftsPaged(userId: string, query: { project_id?: string; q?: string; page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.q?.trim();
    const where: Prisma.NftAssetWhereInput = {
      ownerId: userId,
      ...(query.project_id ? { productId: query.project_id } : {}),
      ...(search ? {
        OR: [
          { assetCode: { contains: search, mode: 'insensitive' } },
          { product: { name: { contains: search, mode: 'insensitive' } } },
          { product: { symbol: { contains: search, mode: 'insensitive' } } },
        ],
      } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.nftAsset.count({ where }),
      this.prisma.nftAsset.findMany({
        where,
        include: { product: true, order: true },
        orderBy: { issuedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { data: rows.map((row) => this.nftAssetView(row)), extra: pageExtra(page, limit, total) };
  }

  async myNftDetail(userId: string, id: string) {
    const row = await this.prisma.nftAsset.findFirst({
      where: { id, ownerId: userId },
      include: { product: true, order: true },
    });
    if (!row) throw new NotFoundException('Không tìm thấy NFT trong tài khoản');
    return this.nftAssetView(row);
  }

  async purchaseOrderDetail(userId: string, id: string) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, userId },
      include: { product: true, nftAssets: { orderBy: { issuedAt: 'asc' } } },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn mua NFT');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { balanceVnd: true } });
    return this.purchaseOrderView(order, user.balanceVnd.toString());
  }

  transactions(userId?: string) {
    return this.prisma.purchaseOrder.findMany({
      where: userId ? { userId } : {},
      include: {
        user: { select: { id: true, email: true, fullName: true, phone: true, referralCode: true, agencyTitle: true } },
        product: true,
        nftAssets: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async buildPurchaseQuote(userId: string, productId: string, quantity: number, referralCode?: string) {
    const [product, user, settings, referral] = await Promise.all([
      this.prisma.nftProduct.findUnique({ where: { id: productId } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.packageSettings(),
      this.resolvePurchaseReferral(userId, referralCode),
    ]);
    if (!product?.isActive) throw new NotFoundException('NFT không tồn tại');
    requireAvailableSupply(product.totalSupply, product.soldCount, quantity);
    const unitPriceVnd = settings.basePriceUsd.mul(settings.usdVndRate).toDecimalPlaces(0);
    const pricing = priceAgencyPackages(user.totalPackagesPurchased, quantity, unitPriceVnd.toNumber());
    const gross = new Prisma.Decimal(pricing.grossAmountVnd);
    const net = new Prisma.Decimal(pricing.netAmountVnd);
    const discount = gross.minus(net);
    const usdRate = settings.usdVndRate;
    const shortage = Prisma.Decimal.max(net.minus(user.balanceVnd), new Prisma.Decimal(0));
    return {
      amount: quantity,
      quantity,
      nft_id: product.id,
      price_nft: unitPriceVnd.toString(),
      total_vnd: net.toString(),
      gross_total_vnd: gross.toString(),
      discount_vnd: discount.toString(),
      effective_discount_rate: pricing.effectiveDiscountRate,
      discount_percent: pricing.effectiveDiscountRate * 100,
      agency_title: pricing.attainedTier.code,
      agency_title_label: pricing.attainedTier.label,
      current_title: user.agencyTitle,
      unit_price_usd: settings.basePriceUsd.toString(),
      usd_vnd_rate: usdRate.toString(),
      gross_amount_usd: gross.div(usdRate).toFixed(2),
      discount_amount_usd: discount.div(usdRate).toFixed(2),
      net_amount_usd: net.div(usdRate).toFixed(2),
      net_amount_vnd: net.toString(),
      starting_package_number: pricing.startingPackageNumber,
      ending_package_number: pricing.endingPackageNumber,
      total_packages_before: user.totalPackagesPurchased,
      total_packages_after: pricing.endingPackageNumber,
      pricing_breakdown: pricing.breakdown,
      balance_vnd: user.balanceVnd.toString(),
      balance_after_vnd: user.balanceVnd.minus(net).toString(),
      shortage_vnd: shortage.toString(),
      can_purchase: Boolean(user.kycVerifiedAt) && shortage.equals(0),
      kyc_verified: Boolean(user.kycVerifiedAt),
      referral_code: referral?.code ?? null,
      referral_code_valid: referralCode ? Boolean(referral) : null,
      referrer_name: referral?.name ?? null,
      referrer_id: referral?.userId ?? null,
      agency_id: null,
    };
  }

  private async resolvePurchaseReferral(userId: string, value?: string) {
    const code = value?.trim();
    if (!code) return null;
    if (!isReferralCodeShape(code)) throw new BadRequestException('Mã giới thiệu không hợp lệ');
    const [account, referrer] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { referredById: true } }),
      this.prisma.user.findFirst({
        where: { referralCode: { equals: code, mode: 'insensitive' } },
        select: { id: true, fullName: true, referralCode: true },
      }),
    ]);
    if (referrer) {
      if (referrer.id === userId) throw new BadRequestException('Không thể sử dụng mã giới thiệu của chính mình');
      if (account.referredById && account.referredById !== referrer.id) throw new BadRequestException('Tài khoản đã liên kết với người giới thiệu khác');
      return { userId: referrer.id, name: referrer.fullName, code: referrer.referralCode };
    }
    const agency = await this.prisma.agency.findUnique({
      where: { code: code.toUpperCase() },
      include: { user: { select: { id: true, fullName: true } }, store: { select: { isActive: true } } },
    });
    if (!agency || agency.status !== 'APPROVED' || !agency.store?.isActive) throw new BadRequestException('Mã giới thiệu không hợp lệ hoặc đã bị khóa');
    if (agency.userId === userId) throw new BadRequestException('Không thể sử dụng mã giới thiệu của chính mình');
    if (account.referredById && account.referredById !== agency.userId) throw new BadRequestException('Tài khoản đã liên kết với người giới thiệu khác');
    return { userId: agency.user.id, name: agency.user.fullName, code: agency.code };
  }

  private packageSettings() {
    return this.prisma.agencyPackageSetting.upsert({
      where: { id: 'default' },
      create: { id: 'default', basePriceUsd: '25', usdVndRate: '25000' },
      update: {},
    });
  }

  private purchaseOrderView(order: {
    id: string;
    productId: string;
    quantity: number;
    unitPriceVnd: Prisma.Decimal;
    totalVnd: Prisma.Decimal;
    grossTotalVnd?: Prisma.Decimal | null;
    discountVnd?: Prisma.Decimal | null;
    effectiveDiscountRate?: Prisma.Decimal | null;
    agencyTitle?: string | null;
    unitPriceUsd?: Prisma.Decimal | null;
    usdVndRate?: Prisma.Decimal | null;
    pricingBreakdown?: Prisma.JsonValue | null;
    referralCode?: string | null;
    status: OrderStatus;
    createdAt: Date;
    updatedAt: Date;
    product?: { id: string; name: string; symbol: string; imageUrl: string } | null;
    nftAssets: Array<{ id: string; assetCode: string; metadataUrl: string; issuedAt: Date }>;
  }, balanceAfterVnd?: string) {
    return {
      id: order.id,
      productId: order.productId,
      unitPriceVnd: order.unitPriceVnd.toString(),
      totalVnd: order.totalVnd.toString(),
      nftAssets: order.nftAssets,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      transaction_code: `TX#${order.id.slice(-8).toUpperCase()}`,
      status: order.status.toLowerCase(),
      product_id: order.productId,
      product: order.product ? { id: order.product.id, name: order.product.name, symbol: order.product.symbol, image_url: order.product.imageUrl } : null,
      quantity: order.quantity,
      unit_price_vnd: order.unitPriceVnd.toString(),
      unit_price_usd: order.unitPriceUsd?.toString() ?? null,
      usd_vnd_rate: order.usdVndRate?.toString() ?? null,
      gross_total_vnd: order.grossTotalVnd?.toString() ?? order.totalVnd.toString(),
      discount_vnd: order.discountVnd?.toString() ?? '0',
      effective_discount_percent: order.effectiveDiscountRate?.mul(100).toString() ?? '0',
      total_vnd: order.totalVnd.toString(),
      agency_title: order.agencyTitle ?? null,
      referral_code: order.referralCode ?? null,
      pricing_breakdown: order.pricingBreakdown ?? [],
      balance_after_vnd: balanceAfterVnd ?? null,
      nft_assets: order.nftAssets.map((asset) => ({
        id: asset.id,
        asset_code: asset.assetCode,
        metadata_url: asset.metadataUrl,
        issued_at: asset.issuedAt.toISOString(),
      })),
      created_at: order.createdAt.toISOString(),
      updated_at: order.updatedAt.toISOString(),
    };
  }

  private nftAssetView(row: {
    id: string;
    assetCode: string;
    metadataUrl: string;
    issuedAt: Date;
    product: { id: string; name: string; symbol: string; description: string; imageUrl: string; totalSupply: number; soldCount: number };
    order: { id: string; unitPriceVnd: Prisma.Decimal; totalVnd: Prisma.Decimal; agencyTitle: string | null; createdAt: Date };
  }) {
    return {
      id: row.id,
      asset_code: row.assetCode,
      metadata_url: row.metadataUrl,
      issued_at: row.issuedAt.toISOString(),
      ownership_system: 'MINDO_INTERNAL',
      blockchain_transaction: null,
      certificate: { type: 'internal', owner_verified: true },
      product: {
        id: row.product.id,
        name: row.product.name,
        symbol: row.product.symbol,
        description: row.product.description,
        image_url: row.product.imageUrl,
        total_supply: row.product.totalSupply,
        sold_count: row.product.soldCount,
      },
      purchase: {
        order_id: row.order.id,
        unit_price_vnd: row.order.unitPriceVnd.toString(),
        order_total_vnd: row.order.totalVnd.toString(),
        agency_title: row.order.agencyTitle,
        purchased_at: row.order.createdAt.toISOString(),
      },
    };
  }

  articles(publishedOnly = true) {
    return this.prisma.newsArticle.findMany({ where: publishedOnly ? { status: ArticleStatus.PUBLISHED } : {}, orderBy: { publishedAt: 'desc' } });
  }

  createArticle(dto: CreateArticleDto) {
    return this.prisma.newsArticle.create({ data: { title: dto.title, slug: dto.slug, summary: dto.summary, content: dto.content, imageUrl: dto.image_url, sourceUrl: dto.source_url, status: dto.status, publishedAt: dto.status === ArticleStatus.PUBLISHED ? new Date() : undefined } });
  }

  async dashboard() {
    const [kycPending, depositsPending, withdrawalsPending, sold, ordersNeedReview] = await Promise.all([
      this.prisma.kycSubmission.count({ where: { status: ReviewStatus.PENDING } }),
      this.prisma.deposit.count({ where: { status: DepositStatus.PENDING } }),
      this.prisma.withdrawal.count({ where: { status: 'PENDING' } }),
      this.prisma.nftAsset.count(),
      this.prisma.purchaseOrder.count({ where: { status: { in: [OrderStatus.PENDING, OrderStatus.FAILED] } } }),
    ]);
    return { kyc_pending: kycPending, deposits_pending: depositsPending, withdrawals_pending: withdrawalsPending, nft_sold: sold, transactions_need_review: ordersNeedReview };
  }

  async users() {
    const users = await this.prisma.user.findMany({ where: { role: UserRole.INVESTOR }, orderBy: { createdAt: 'desc' } });
    return users.map(userView);
  }

  private depositView<T extends { vietQrData: Prisma.JsonValue | null; expiresAt?: Date | null; status?: DepositStatus }>(deposit: T) {
    const qrExpired = deposit.status === DepositStatus.PENDING && Boolean(deposit.expiresAt && deposit.expiresAt <= new Date());
    return {
      ...deposit,
      vietqr: deposit.vietQrData,
      expires_at: deposit.expiresAt?.toISOString() ?? null,
      qr_expired: qrExpired,
      display_status: qrExpired ? 'expired' : deposit.status?.toLowerCase(),
    };
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
