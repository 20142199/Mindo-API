import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AgencyPackageStatus, AgencyStatus, Prisma, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { userView } from '../auth/auth.service';
import { PrismaService } from '../common/prisma.module';
import {
  BuyAgencyPackageDto,
  CreateAdminAccountDto,
  CreateAgencyApplicationDto,
  ResetAdminPasswordDto,
  ReviewAgencyDto,
  UpdateAdminRoleDto,
  UpdateAgencyStoreDto,
} from './phase2.dto';
import { agencyTierForQuantity, buildAgencyTree, slugifyStoreName } from './phase2.domain';

const operationalRoles: UserRole[] = [UserRole.ADMIN, UserRole.COMPLIANCE, UserRole.FINANCE];
const reviewStatuses: AgencyStatus[] = [AgencyStatus.APPROVED, AgencyStatus.REJECTED, AgencyStatus.LOCKED];

@Injectable()
export class AgencyService {
  constructor(private readonly prisma: PrismaService) {}

  async apply(userId: string, dto: CreateAgencyApplicationDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { referredBy: { include: { agency: true } } } });
    if (!user.kycVerifiedAt) throw new BadRequestException('Cần hoàn tất KYC trước khi đăng ký đại lý');
    if (await this.prisma.agency.findUnique({ where: { userId } })) throw new BadRequestException('Tài khoản đã có hồ sơ đại lý');
    let parentId = user.referredBy?.agency?.status === AgencyStatus.APPROVED ? user.referredBy.agency.id : undefined;
    if (dto.parent_code) {
      const parent = await this.prisma.agency.findUnique({ where: { code: dto.parent_code.toUpperCase() } });
      if (!parent || parent.status !== AgencyStatus.APPROVED) throw new BadRequestException('Mã đại lý tuyến trên không hợp lệ');
      parentId = parent.id;
    }
    const code = this.agencyCode();
    const agency = await this.prisma.agency.create({
      data: {
        userId,
        code,
        businessName: dto.business_name,
        taxCode: dto.tax_code,
        phone: dto.phone,
        address: dto.address,
        parentId,
        store: {
          create: {
            slug: `${slugifyStoreName(dto.business_name)}-${code.toLowerCase()}`,
            name: dto.business_name,
            contactEmail: user.email,
            contactPhone: dto.phone,
          },
        },
      },
      include: this.agencyInclude,
    });
    await this.prisma.auditLog.create({ data: { actorId: userId, action: 'AGENCY_APPLIED', entityType: 'Agency', entityId: agency.id } });
    return this.view(agency);
  }

  async mine(userId: string) {
    const agency = await this.prisma.agency.findUnique({ where: { userId }, include: this.agencyInclude });
    return agency ? this.view(agency) : null;
  }

  async updateStore(userId: string, dto: UpdateAgencyStoreDto) {
    const agency = await this.requireApprovedAgency(userId);
    const store = await this.prisma.agencyStore.update({
      where: { agencyId: agency.id },
      data: {
        name: dto.name,
        description: dto.description,
        logoUrl: dto.logo_url,
        bannerUrl: dto.banner_url,
        contactEmail: dto.contact_email,
        contactPhone: dto.contact_phone,
        primaryColor: dto.primary_color,
      },
    });
    await this.prisma.auditLog.create({ data: { actorId: userId, action: 'AGENCY_STORE_UPDATED', entityType: 'AgencyStore', entityId: store.id } });
    return store;
  }

  async buyPackage(userId: string, dto: BuyAgencyPackageDto) {
    const tier = agencyTierForQuantity(dto.quantity);
    return this.prisma.$transaction(async (tx) => {
      const agency = await tx.agency.findUnique({ where: { userId }, include: { user: true } });
      if (!agency || agency.status !== AgencyStatus.APPROVED) throw new ForbiddenException('Đại lý chưa được phê duyệt');
      const product = await tx.nftProduct.findUnique({ where: { id: dto.product_id } });
      if (!product?.isActive) throw new NotFoundException('Gói NFT không tồn tại');
      const gross = product.unitPriceVnd.mul(dto.quantity);
      const rate = new Prisma.Decimal(tier.discountRate);
      const net = gross.mul(new Prisma.Decimal(1).minus(rate)).toDecimalPlaces(0);
      if (agency.user.balanceVnd.lessThan(net)) throw new BadRequestException('Số dư không đủ để mua gói đại lý');
      await tx.agencyPackagePurchase.updateMany({
        where: { agencyId: agency.id, status: AgencyPackageStatus.ACTIVE },
        data: { status: AgencyPackageStatus.CANCELLED },
      });
      const purchased = await tx.agencyPackagePurchase.create({
        data: {
          agencyId: agency.id,
          productId: product.id,
          tier: tier.code,
          quantity: dto.quantity,
          discountRate: rate,
          grossAmountVnd: gross,
          netAmountVnd: net,
          commissionSlots: dto.quantity,
          remainingCommissionSlots: dto.quantity,
        },
        include: { product: true },
      });
      await tx.user.update({ where: { id: userId }, data: { balanceVnd: { decrement: net } } });
      await tx.ledgerEntry.create({ data: { userId, amountVnd: net, direction: 'DEBIT', description: `Mua ${tier.label} đại lý (${dto.quantity} suất)` } });
      await tx.auditLog.create({
        data: { actorId: userId, action: 'AGENCY_PACKAGE_PURCHASED', entityType: 'AgencyPackagePurchase', entityId: purchased.id, metadata: { tier: tier.code, quantity: dto.quantity } },
      });
      return purchased;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async dashboard(userId: string) {
    const agency = await this.requireAgency(userId);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const [customers, monthRevenue, monthCommission, commissions, orders] = await Promise.all([
      this.prisma.user.count({ where: { referredBy: { agency: { id: agency.id } } } }),
      this.prisma.purchaseOrder.aggregate({ where: { agencyId: agency.id, createdAt: { gte: monthStart } }, _sum: { totalVnd: true } }),
      this.prisma.agencyCommission.aggregate({ where: { agencyId: agency.id, createdAt: { gte: monthStart } }, _sum: { amountVnd: true } }),
      this.prisma.agencyCommission.findMany({ where: { agencyId: agency.id }, include: { buyer: true, order: { include: { product: true } } }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.purchaseOrder.findMany({ where: { agencyId: agency.id }, include: { user: true, product: true }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    return {
      agency: await this.mine(userId),
      metrics: {
        total_customers: customers,
        total_revenue_vnd: agency.totalRevenueVnd.toString(),
        total_commission_vnd: agency.totalCommissionVnd.toString(),
        month_revenue_vnd: monthRevenue._sum.totalVnd?.toString() ?? '0',
        month_commission_vnd: monthCommission._sum.amountVnd?.toString() ?? '0',
      },
      commissions,
      orders,
    };
  }

  async publicStore(slug: string) {
    const store = await this.prisma.agencyStore.findUnique({
      where: { slug },
      include: { agency: { include: { user: { select: { fullName: true } } } } },
    });
    if (!store?.isActive || store.agency.status !== AgencyStatus.APPROVED) throw new NotFoundException('Cửa hàng đại lý không tồn tại');
    const products = await this.prisma.nftProduct.findMany({ where: { isActive: true }, orderBy: { createdAt: 'desc' } });
    return { store, agency: { code: store.agency.code, owner_name: store.agency.user.fullName }, products };
  }

  async adminStats() {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const [pending, active, revenue, commission] = await Promise.all([
      this.prisma.agency.count({ where: { status: AgencyStatus.PENDING } }),
      this.prisma.agency.count({ where: { status: AgencyStatus.APPROVED } }),
      this.prisma.purchaseOrder.aggregate({ where: { agencyId: { not: null }, createdAt: { gte: monthStart } }, _sum: { totalVnd: true } }),
      this.prisma.agencyCommission.aggregate({ where: { createdAt: { gte: monthStart } }, _sum: { amountVnd: true } }),
    ]);
    return { pending, active, month_revenue_vnd: revenue._sum.totalVnd?.toString() ?? '0', month_commission_vnd: commission._sum.amountVnd?.toString() ?? '0' };
  }

  async adminList(search?: string, status?: AgencyStatus) {
    const rows = await this.prisma.agency.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(search ? { OR: [
          { code: { contains: search, mode: 'insensitive' } },
          { businessName: { contains: search, mode: 'insensitive' } },
          { user: { email: { contains: search, mode: 'insensitive' } } },
        ] } : {}),
      },
      include: this.agencyInclude,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.view(row));
  }

  async detail(id: string) {
    const row = await this.prisma.agency.findUnique({ where: { id }, include: this.agencyInclude });
    if (!row) throw new NotFoundException('Đại lý không tồn tại');
    const [children, recentOrders, recentCommissions] = await Promise.all([
      this.prisma.agency.findMany({ where: { parentId: id }, include: { user: true, store: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.purchaseOrder.findMany({ where: { agencyId: id }, include: { user: true, product: true }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.agencyCommission.findMany({ where: { agencyId: id }, include: { buyer: true, order: { include: { product: true } } }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    return { ...this.view(row), children, recent_orders: recentOrders, recent_commissions: recentCommissions };
  }

  async review(actorId: string, id: string, dto: ReviewAgencyDto) {
    if (!reviewStatuses.includes(dto.status)) throw new BadRequestException('Trạng thái đại lý không hợp lệ');
    if (dto.status === AgencyStatus.REJECTED && !dto.rejection_reason?.trim()) throw new BadRequestException('Cần nhập lý do từ chối');
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.agency.findUnique({ where: { id }, include: { user: true, store: true, contract: true } });
      if (!current) throw new NotFoundException('Đại lý không tồn tại');
      const now = new Date();
      const updated = await tx.agency.update({
        where: { id },
        data: {
          status: dto.status,
          reviewNote: dto.review_note,
          rejectionReason: dto.status === AgencyStatus.REJECTED ? dto.rejection_reason : null,
          reviewedById: actorId,
          reviewedAt: now,
          approvedAt: dto.status === AgencyStatus.APPROVED ? current.approvedAt ?? now : current.approvedAt,
          lockedAt: dto.status === AgencyStatus.LOCKED ? now : null,
        },
      });
      await tx.agencyStore.update({ where: { agencyId: id }, data: { isActive: dto.status === AgencyStatus.APPROVED } });
      if (dto.status === AgencyStatus.APPROVED && !current.contract) {
        await tx.agencyContract.create({
          data: {
            agencyId: id,
            issuedById: actorId,
            contractNumber: `MD-${now.getFullYear()}-${current.code}`,
            snapshot: {
              agencyCode: current.code,
              businessName: current.businessName,
              representative: current.user.fullName,
              email: current.user.email,
              phone: current.phone,
              address: current.address,
              taxCode: current.taxCode,
            },
          },
        });
      }
      await tx.auditLog.create({
        data: { actorId, action: `AGENCY_${dto.status}`, entityType: 'Agency', entityId: id, metadata: { reviewNote: dto.review_note, rejectionReason: dto.rejection_reason } },
      });
      return updated;
    });
  }

  async tree() {
    const rows = await this.prisma.agency.findMany({
      include: { user: { select: { fullName: true, email: true } }, store: true },
      orderBy: { createdAt: 'asc' },
    });
    return buildAgencyTree(rows);
  }

  async contractHtml(id: string) {
    const contract = await this.prisma.agencyContract.findUnique({ where: { agencyId: id }, include: { agency: true } });
    if (!contract) throw new NotFoundException('Hợp đồng chưa được phát hành');
    const snapshot = contract.snapshot as Record<string, unknown>;
    const value = (key: string) => this.escapeHtml(String(snapshot[key] ?? ''));
    const date = new Intl.DateTimeFormat('vi-VN').format(contract.issuedAt);
    return {
      filename: `${contract.contractNumber}.html`,
      html: `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${contract.contractNumber}</title><style>body{font-family:Arial,sans-serif;max-width:820px;margin:48px auto;color:#111827;line-height:1.6}h1,h2{text-align:center;color:#0b1f3a}.meta{margin:32px 0;padding:18px;border:1px solid #dbe3f0}dt{font-weight:700}dd{margin:0 0 10px}.sign{display:grid;grid-template-columns:1fr 1fr;gap:80px;margin-top:70px;text-align:center}</style></head><body><h1>HỢP ĐỒNG ĐẠI LÝ MINDO</h1><h2>Số ${this.escapeHtml(contract.contractNumber)}</h2><p>Ngày phát hành: ${date}</p><div class="meta"><dl><dt>Mã đại lý</dt><dd>${value('agencyCode')}</dd><dt>Tên kinh doanh</dt><dd>${value('businessName')}</dd><dt>Người đại diện</dt><dd>${value('representative')}</dd><dt>Email</dt><dd>${value('email')}</dd><dt>Điện thoại</dt><dd>${value('phone')}</dd><dt>Địa chỉ</dt><dd>${value('address')}</dd><dt>Mã số thuế</dt><dd>${value('taxCode')}</dd></dl></div><p>Đại lý đồng ý tuân thủ chính sách bán NFT, chính sách hoa hồng và các quy định vận hành do Mindo công bố tại từng thời điểm.</p><div class="sign"><div><strong>ĐẠI DIỆN MINDO</strong></div><div><strong>ĐẠI DIỆN ĐẠI LÝ</strong></div></div></body></html>`,
    };
  }

  async adminAccounts() {
    const rows = await this.prisma.user.findMany({ where: { role: { in: operationalRoles } }, orderBy: { createdAt: 'desc' } });
    return rows.map(userView);
  }

  async createAdmin(actorId: string, dto: CreateAdminAccountDto) {
    if (!operationalRoles.includes(dto.role)) throw new BadRequestException('Vai trò quản trị không hợp lệ');
    const email = dto.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new BadRequestException('Email đã tồn tại');
    const user = await this.prisma.user.create({ data: { email, fullName: dto.full_name, passwordHash: await bcrypt.hash(dto.password, 12), role: dto.role, emailVerifiedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { actorId, action: 'ADMIN_CREATED', entityType: 'User', entityId: user.id, metadata: { role: dto.role } } });
    return userView(user);
  }

  async updateAdminRole(actorId: string, id: string, dto: UpdateAdminRoleDto) {
    if (!operationalRoles.includes(dto.role)) throw new BadRequestException('Vai trò quản trị không hợp lệ');
    if (actorId === id && dto.role !== UserRole.ADMIN) throw new BadRequestException('Không thể tự hạ quyền tài khoản đang đăng nhập');
    const target = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    if (!operationalRoles.includes(target.role)) throw new BadRequestException('Tài khoản không phải quản trị viên');
    const updated = await this.prisma.user.update({ where: { id }, data: { role: dto.role } });
    await this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { actorId, action: 'ADMIN_ROLE_UPDATED', entityType: 'User', entityId: id, metadata: { role: dto.role } } });
    return userView(updated);
  }

  async resetAdminPassword(actorId: string, id: string, dto: ResetAdminPasswordDto) {
    const target = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    if (!operationalRoles.includes(target.role)) throw new BadRequestException('Tài khoản không phải quản trị viên');
    await this.prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(dto.password, 12) } });
    await this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { actorId, action: 'ADMIN_PASSWORD_RESET', entityType: 'User', entityId: id } });
    return { reset: true };
  }

  async deleteAdmin(actorId: string, id: string) {
    if (actorId === id) throw new BadRequestException('Không thể tự xóa tài khoản đang đăng nhập');
    const target = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    if (!operationalRoles.includes(target.role)) throw new BadRequestException('Tài khoản không phải quản trị viên');
    const updated = await this.prisma.user.update({ where: { id }, data: { status: UserStatus.DELETED } });
    await this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { actorId, action: 'ADMIN_DELETED', entityType: 'User', entityId: id } });
    return userView(updated);
  }

  private requireAgency(userId: string) {
    return this.prisma.agency.findUnique({ where: { userId } }).then((agency) => {
      if (!agency) throw new NotFoundException('Chưa đăng ký đại lý');
      return agency;
    });
  }

  private async requireApprovedAgency(userId: string) {
    const agency = await this.requireAgency(userId);
    if (agency.status !== AgencyStatus.APPROVED) throw new ForbiddenException('Đại lý chưa được phê duyệt');
    return agency;
  }

  private agencyCode() {
    return `DL${Date.now().toString(36).toUpperCase()}${randomInt(100, 1000)}`;
  }

  private view<T extends { packages: Array<{ status: AgencyPackageStatus }>; _count: { children: number } }>(row: T) {
    const activePackage = row.packages.find((item) => item.status === AgencyPackageStatus.ACTIVE) ?? row.packages[0] ?? null;
    return { ...row, active_package: activePackage, child_count: row._count.children };
  }

  private escapeHtml(value: string) {
    return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
  }

  private readonly agencyInclude = {
    user: { select: { id: true, fullName: true, email: true, phone: true, referralCode: true } },
    store: true,
    parent: { include: { user: { select: { fullName: true, email: true } } } },
    packages: { include: { product: true }, orderBy: { createdAt: 'desc' as const } },
    contract: true,
    _count: { select: { children: true, purchaseOrders: true, commissions: true } },
  } as const;
}
