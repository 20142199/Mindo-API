import { AgencyStatus, ArticleStatus, PrismaClient, ReviewStatus, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const admin = await prisma.user.upsert({
    where: { email: process.env.ADMIN_EMAIL ?? 'admin@local.test' },
    update: { emailVerifiedAt: new Date() },
    create: {
      email: process.env.ADMIN_EMAIL ?? 'admin@local.test',
      passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD ?? 'ChangeMe123!', 12),
      fullName: 'Quản trị viên',
      role: UserRole.ADMIN,
      emailVerifiedAt: new Date(),
    },
  });

  const investor = await prisma.user.upsert({
    where: { email: 'investor@local.test' },
    update: { emailVerifiedAt: new Date() },
    create: {
      email: 'investor@local.test',
      passwordHash: await bcrypt.hash('Investor123!', 12),
      fullName: 'Nguyễn Minh Anh',
      phone: '0987654321',
      phoneNormalized: '0987654321',
      emailVerifiedAt: new Date(),
    },
  });

  const hasKyc = await prisma.kycSubmission.findFirst({ where: { userId: investor.id } });
  if (!hasKyc) {
    await prisma.kycSubmission.create({
      data: {
        userId: investor.id,
        fullName: investor.fullName,
        dateOfBirth: new Date('1995-08-12'),
        idCardNumber: '036095012345',
        phoneNumber: investor.phone ?? '',
        address: 'Quận 1, TP. Hồ Chí Minh',
        idFrontFileUrl: '/demo/cccd-front.jpg',
        idBackFileUrl: '/demo/cccd-back.jpg',
        status: ReviewStatus.PENDING,
      },
    });
  }

  if ((await prisma.nftProduct.count()) === 0) {
    await prisma.nftProduct.create({
      data: {
        name: 'Mindo Genesis',
        symbol: 'MINDO',
        description: 'NFT nội bộ Mindo được quản lý trực tiếp trên hệ thống',
        imageUrl: 'https://placehold.co/800x800/053c35/ffffff?text=Mindo+Genesis',
        metadataBaseUrl: 'https://metadata.example.test/mindo',
        unitPriceVnd: '3200000',
        totalSupply: 10000,
      },
    });
  }

  const agentUser = await prisma.user.upsert({
    where: { email: 'agent@local.test' },
    update: { emailVerifiedAt: new Date(), kycVerifiedAt: new Date() },
    create: {
      email: 'agent@local.test',
      passwordHash: await bcrypt.hash('Agent123!', 12),
      fullName: 'Nguyễn Văn Lộc',
      phone: '0988123456',
      phoneNormalized: '0988123456',
      balanceVnd: '500000000',
      emailVerifiedAt: new Date(),
      kycVerifiedAt: new Date(),
    },
  });
  const agency = await prisma.agency.upsert({
    where: { userId: agentUser.id },
    update: { status: AgencyStatus.APPROVED, approvedAt: new Date() },
    create: {
      userId: agentUser.id,
      code: 'DL000128',
      businessName: 'Lộc Store',
      taxCode: '0123456789-001',
      phone: agentUser.phone ?? '0988123456',
      address: '123 Đường ABC, Quận 1, TP. Hồ Chí Minh',
      status: AgencyStatus.APPROVED,
      approvedAt: new Date(),
      reviewedById: admin.id,
      reviewedAt: new Date(),
    },
  });
  await prisma.agencyStore.upsert({
    where: { agencyId: agency.id },
    update: { isActive: true },
    create: {
      agencyId: agency.id,
      slug: 'loc-store-dl000128',
      name: 'Lộc Store',
      description: 'Cửa hàng NFT của đại lý Mindo Nguyễn Văn Lộc.',
      contactEmail: agentUser.email,
      contactPhone: agentUser.phone,
      isActive: true,
    },
  });
  await prisma.agencyContract.upsert({
    where: { agencyId: agency.id },
    update: {},
    create: {
      agencyId: agency.id,
      issuedById: admin.id,
      contractNumber: `MD-${new Date().getFullYear()}-${agency.code}`,
      snapshot: { agencyCode: agency.code, businessName: agency.businessName, representative: agentUser.fullName, email: agentUser.email, phone: agency.phone, address: agency.address, taxCode: agency.taxCode },
    },
  });
  const product = await prisma.nftProduct.findFirst({ orderBy: { createdAt: 'asc' } });
  if (product && (await prisma.agencyPackagePurchase.count({ where: { agencyId: agency.id } })) === 0) {
    await prisma.agencyPackagePurchase.create({
      data: {
        agencyId: agency.id,
        productId: product.id,
        tier: 'TIER_2',
        quantity: 50,
        discountRate: '0.30',
        grossAmountVnd: '31250000',
        netAmountVnd: '24937500',
        unitPriceUsd: '25',
        usdVndRate: '25000',
        unitPriceVnd: '625000',
        startingPackageNumber: 1,
        endingPackageNumber: 50,
        effectiveDiscountRate: '0.202',
        pricingBreakdown: [
          { tier: 'TIER_1', title: 'Đại lý 1', from_package: 1, to_package: 49, quantity: 49, discount_rate: 0.2, gross_amount_vnd: 30625000, net_amount_vnd: 24500000 },
          { tier: 'TIER_2', title: 'Đại lý 2', from_package: 50, to_package: 50, quantity: 1, discount_rate: 0.3, gross_amount_vnd: 625000, net_amount_vnd: 437500 },
        ],
        commissionSlots: 50,
        remainingCommissionSlots: 50,
      },
    });
    await prisma.agency.update({ where: { id: agency.id }, data: { title: 'TIER_2', totalPackagesPurchased: 50, discountRate: '0.30' } });
  }

  const experts = [
    { slug: 'mindo-tai-chinh', name: 'Minh Tâm', specialty: 'Tài chính cá nhân', description: 'Hỗ trợ giải thích kế hoạch tài chính và quản lý dòng tiền.', systemPrompt: 'Bạn là chuyên gia tài chính của Mindo. Trả lời rõ ràng, thận trọng và không hứa hẹn lợi nhuận.', capabilities: ['CHAT', 'DOCUMENT'] },
    { slug: 'mindo-suc-khoe', name: 'An Nhiên', specialty: 'Sức khỏe tổng quát', description: 'Cung cấp thông tin sức khỏe phổ thông và hướng dẫn tìm trợ giúp chuyên môn.', systemPrompt: 'Bạn cung cấp thông tin sức khỏe phổ thông, luôn nhắc người dùng gặp bác sĩ khi có dấu hiệu nghiêm trọng.', capabilities: ['CHAT', 'DOCUMENT', 'TRANSLATION'] },
    { slug: 'mindo-sang-tao', name: 'Lam Anh', specialty: 'Nội dung và hình ảnh', description: 'Hỗ trợ viết nội dung, tạo ý tưởng hình ảnh và tài liệu.', systemPrompt: 'Bạn là chuyên gia sáng tạo nội dung của Mindo. Tạo nội dung hữu ích, cụ thể và an toàn.', capabilities: ['CHAT', 'IMAGE', 'DOCUMENT', 'TRANSLATION'] },
  ];
  for (const expert of experts) {
    await prisma.aiExpert.upsert({ where: { slug: expert.slug }, update: expert, create: expert });
  }

  if ((await prisma.newsArticle.count()) === 0) {
    await prisma.newsArticle.create({
      data: {
        title: 'Mindo bắt đầu thử nghiệm Phase 1',
        slug: 'mindo-phase-1-testnet',
        summary: 'Các luồng KYC, nạp tiền và NFT nội bộ đã sẵn sàng để thử nghiệm.',
        content: 'Bản thử nghiệm tập trung vào luồng người dùng, xác minh KYC, nạp tiền VND và nhận NFT trực tiếp trong tài khoản Mindo.',
        status: ArticleStatus.PUBLISHED,
        publishedAt: new Date(),
      },
    });
  }

  console.log(`Seeded admin ${admin.email} and investor ${investor.email}`);
}

main().finally(() => prisma.$disconnect());
