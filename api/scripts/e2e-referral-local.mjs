import { Prisma, PrismaClient, ReferralCommissionType } from '@prisma/client';

const prisma = new PrismaClient();
const apiBase = process.env.E2E_API_URL ?? 'http://127.0.0.1:4000/api/v1';
const runId = Date.now().toString(36);
const rootEmail = `ref-root-${runId}@mindo.local`;
const childEmail = `ref-child-${runId}@mindo.local`;
const password = 'Referral123!';
let adminTokenId;
let systemCodeId;
let rootId;
let childId;
let orderId;
let productId;
let originalSettings;
const startedAt = new Date();

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function request(pathname, options = {}) {
  const response = await fetch(`${apiBase}${pathname}`, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${pathname} -> ${response.status}: ${text}`);
  return body;
}

async function cleanup() {
  const userIds = [rootId, childId].filter(Boolean);
  if (orderId) {
    const commissionIds = (await prisma.referralCommission.findMany({ where: { orderId }, select: { id: true } })).map((row) => row.id);
    await prisma.ledgerEntry.deleteMany({ where: { OR: [{ orderId }, { referralCommissionId: { in: commissionIds } }] } });
    await prisma.referralCommission.deleteMany({ where: { orderId } });
    await prisma.nftAsset.deleteMany({ where: { orderId } });
    await prisma.purchaseOrder.deleteMany({ where: { id: orderId } });
    if (productId) await prisma.nftProduct.update({ where: { id: productId }, data: { soldCount: { decrement: 1 } } });
  }
  if (userIds.length) {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.ledgerEntry.deleteMany({ where: { userId: { in: userIds } } });
  }
  await prisma.verificationCode.deleteMany({ where: { email: { in: [rootEmail, childEmail] } } });
  if (systemCodeId) {
    await prisma.auditLog.deleteMany({ where: { entityType: 'SystemReferralCode', entityId: systemCodeId } });
    await prisma.systemReferralCode.deleteMany({ where: { id: systemCodeId } });
  }
  if (childId) await prisma.user.deleteMany({ where: { id: childId } });
  if (rootId) await prisma.user.deleteMany({ where: { id: rootId } });
  if (adminTokenId) await prisma.refreshToken.deleteMany({ where: { id: adminTokenId } });
  if (originalSettings) {
    await prisma.referralSetting.update({
      where: { id: 'default' },
      data: { directRate: originalSettings.directRate, branchRate: originalSettings.branchRate, updatedById: originalSettings.updatedById },
    });
  }
  await prisma.auditLog.deleteMany({
    where: { action: 'REFERRAL_SETTINGS_UPDATED', entityType: 'ReferralSetting', entityId: 'default', createdAt: { gte: startedAt } },
  });
}

try {
  const adminLogin = await request('/admin/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL ?? 'admin@local.test', password: process.env.ADMIN_PASSWORD ?? 'ChangeMe123!' }),
  });
  const adminToken = adminLogin.data.access_token;
  adminTokenId = adminLogin.data.session_id;
  const adminHeaders = { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' };
  originalSettings = await prisma.referralSetting.findUnique({ where: { id: 'default' } });
  await request('/admin/referrals/settings', {
    method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ direct_rate_percent: 10, branch_rate_percent: 5 }),
  });
  const codeResponse = await request('/admin/referrals/system-codes', {
    method: 'POST', headers: adminHeaders, body: JSON.stringify({ label: `E2E ${runId}` }),
  });
  const systemCode = codeResponse.data;
  systemCodeId = systemCode.id;
  assert(systemCode.code.startsWith('SYS'), 'Mã đầu nhánh không có tiền tố SYS');

  const rootRegistration = await request('/investor/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ full_name: 'Referral Root', email: rootEmail, password, confirm_password: password, accept_terms: true, ref_by: systemCode.code }),
  });
  rootId = rootRegistration.data.user.id;
  const rootReferralCode = rootRegistration.data.user.referral_code;
  assert(rootReferralCode.startsWith('MD'), 'Tài khoản đầu nhánh chưa được sinh mã MD');
  const claimedCode = await prisma.systemReferralCode.findUniqueOrThrow({ where: { id: systemCodeId } });
  assert(claimedCode.claimedById === rootId && claimedCode.isActive === false, 'Mã hệ thống chưa được khóa sau khi sử dụng');

  const childRegistration = await request('/investor/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ full_name: 'Referral Child', email: childEmail, password, confirm_password: password, accept_terms: true, ref_by: rootReferralCode }),
  });
  childId = childRegistration.data.user.id;
  assert(childRegistration.data.user.referred_by_id === rootId, 'F1 chưa liên kết với F0 bằng user_id');

  await prisma.user.update({ where: { id: rootId }, data: { emailVerifiedAt: new Date(), kycVerifiedAt: new Date() } });
  await prisma.user.update({ where: { id: childId }, data: { emailVerifiedAt: new Date(), kycVerifiedAt: new Date(), balanceVnd: '10000000' } });

  const childLogin = await request('/investor/auth/login/email', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: childEmail, password }),
  });
  const childHeaders = { authorization: `Bearer ${childLogin.data.access_token}`, 'content-type': 'application/json' };
  const products = await request('/nfts');
  const product = products.data[0];
  assert(product, 'Không có sản phẩm để kiểm thử');
  productId = product.id;
  const unitPrice = new Prisma.Decimal(product.unitPriceVnd);
  const snapshot = await request('/investor/invest/snapshot-price', {
    method: 'POST', headers: childHeaders, body: JSON.stringify({ nft_id: product.id, amount: 1, payment_type: 'BALANCE' }),
  });
  const purchase = await request('/investor/invest', {
    method: 'POST', headers: childHeaders, body: JSON.stringify({ price_snapshot: snapshot.data.price_snapshot }),
  });
  orderId = purchase.data.id;

  const commissions = await prisma.referralCommission.findMany({ where: { orderId } });
  assert(commissions.length === 2, 'Đơn F1 chưa tạo đủ hai khoản thưởng');
  const direct = commissions.find((row) => row.type === ReferralCommissionType.DIRECT);
  const branch = commissions.find((row) => row.type === ReferralCommissionType.BRANCH);
  assert(direct?.amountVnd.equals(unitPrice.mul('0.10')), 'Thưởng F0 không đúng 10%');
  assert(branch?.amountVnd.equals(unitPrice.mul('0.05')), 'Thưởng đầu nhánh không đúng 5%');

  const rootLogin = await request('/investor/auth/login/email', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: rootEmail, password }),
  });
  const dashboard = await request('/investor/referrals/dashboard', { headers: { authorization: `Bearer ${rootLogin.data.access_token}` } });
  assert(dashboard.data.is_branch_root === true, 'Dashboard chưa nhận diện tài khoản đầu nhánh');
  assert(dashboard.data.downline_count === 1, 'Dashboard chưa đếm đúng cây tuyến dưới');
  assert(dashboard.data.downline_sales_vnd === unitPrice.toString(), 'Dashboard chưa cộng đúng doanh số cây');
  assert(dashboard.data.total_commission_vnd === unitPrice.mul('0.15').toString(), 'Dashboard chưa cộng đúng tổng thưởng');

  const adminCodes = await request('/admin/referrals/system-codes', { headers: adminHeaders });
  const adminBranch = adminCodes.data.find((row) => row.id === systemCodeId);
  assert(adminBranch?.downline_count === 1 && adminBranch.downline_sales_vnd === unitPrice.toString(), 'Admin chưa hiển thị đúng doanh số đầu nhánh');
  console.log(`Referral E2E passed: ${systemCode.code} -> ${rootReferralCode}, order ${orderId}`);
} finally {
  await cleanup();
  await prisma.$disconnect();
}
