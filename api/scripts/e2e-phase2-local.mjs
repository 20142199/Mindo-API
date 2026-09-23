import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const apiBase = process.env.E2E_API_URL ?? 'http://127.0.0.1:4000/api/v1';
const runId = Date.now().toString(36);
const applicantEmail = `phase2-agent-${runId}@mindo.local`;
const buyerEmail = `phase2-buyer-${runId}@mindo.local`;
const adminEmail = `phase2-admin-${runId}@mindo.local`;
const adminTokenIdsBefore = new Set();
const testStartedAt = new Date();
let packageSettingBefore;
let packageSettingTouched = false;

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, options);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${path} -> ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  return body;
}

async function login(email, password) {
  const body = await request('/investor/auth/login/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return { authorization: `Bearer ${body.data.access_token}` };
}

async function cleanup() {
  if (packageSettingTouched) {
    await prisma.auditLog.deleteMany({ where: { action: 'AGENCY_PACKAGE_EXCHANGE_RATE_UPDATED', entityId: 'default', createdAt: { gte: testStartedAt } } });
    if (packageSettingBefore) {
      await prisma.agencyPackageSetting.upsert({
        where: { id: packageSettingBefore.id },
        create: packageSettingBefore,
        update: {
          basePriceUsd: packageSettingBefore.basePriceUsd,
          usdVndRate: packageSettingBefore.usdVndRate,
          updatedById: packageSettingBefore.updatedById,
          createdAt: packageSettingBefore.createdAt,
          updatedAt: packageSettingBefore.updatedAt,
        },
      });
    } else {
      await prisma.agencyPackageSetting.deleteMany({ where: { id: 'default' } });
    }
  }
  const users = await prisma.user.findMany({ where: { email: { in: [applicantEmail, buyerEmail, adminEmail] } }, select: { id: true } });
  const userIds = users.map((user) => user.id);
  if (!userIds.length) return;
  const agencies = await prisma.agency.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const agencyIds = agencies.map((agency) => agency.id);
  const orders = await prisma.purchaseOrder.findMany({ where: { OR: [{ userId: { in: userIds } }, { agencyId: { in: agencyIds } }] }, select: { id: true } });
  const orderIds = orders.map((order) => order.id);
  const assets = orderIds.length ? await prisma.nftAsset.findMany({ where: { orderId: { in: orderIds } }, select: { productId: true } }) : [];
  const commissions = orderIds.length ? await prisma.agencyCommission.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } }) : [];
  const commissionIds = commissions.map((commission) => commission.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: [...userIds, ...agencyIds, ...orderIds] } }] } });
  await prisma.ledgerEntry.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { orderId: { in: orderIds } }, { commissionId: { in: commissionIds } }] } });
  if (orderIds.length) {
    await prisma.nftAsset.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.agencyCommission.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  }
  for (const asset of assets) await prisma.nftProduct.update({ where: { id: asset.productId }, data: { soldCount: { decrement: 1 } } });
  if (agencyIds.length) {
    await prisma.agencyPackagePurchase.deleteMany({ where: { agencyId: { in: agencyIds } } });
    await prisma.agencyContract.deleteMany({ where: { agencyId: { in: agencyIds } } });
    await prisma.agencyStore.deleteMany({ where: { agencyId: { in: agencyIds } } });
    await prisma.agency.deleteMany({ where: { id: { in: agencyIds } } });
  }
  await prisma.aiConversation.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  const seededAdmin = await prisma.user.findUnique({ where: { email: 'admin@local.test' } });
  if (seededAdmin) {
    const tokens = await prisma.refreshToken.findMany({ where: { userId: seededAdmin.id }, select: { id: true } });
    const created = tokens.map((token) => token.id).filter((id) => !adminTokenIdsBefore.has(id));
    if (created.length) await prisma.refreshToken.deleteMany({ where: { id: { in: created } } });
  }
}

try {
  const passwordHash = await bcrypt.hash('Integration123!', 12);
  await prisma.user.createMany({ data: [
    { email: applicantEmail, passwordHash, fullName: 'Đại lý Phase 2', phone: '0900000021', balanceVnd: '500000000', emailVerifiedAt: new Date(), kycVerifiedAt: new Date(), referralCode: `AG${runId}` },
    { email: buyerEmail, passwordHash, fullName: 'Khách mua Phase 2', phone: '0900000022', balanceVnd: '100000000', emailVerifiedAt: new Date(), kycVerifiedAt: new Date(), referralCode: `BY${runId}` },
  ] });
  const applicantAuth = await login(applicantEmail, 'Integration123!');
  const buyerAuth = await login(buyerEmail, 'Integration123!');
  const seededAdmin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@local.test' } });
  (await prisma.refreshToken.findMany({ where: { userId: seededAdmin.id }, select: { id: true } })).forEach((token) => adminTokenIdsBefore.add(token.id));
  const adminLogin = await request('/admin/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@local.test', password: 'ChangeMe123!' }) });
  const adminAuth = { authorization: `Bearer ${adminLogin.data.access_token}` };
  packageSettingBefore = await prisma.agencyPackageSetting.findUnique({ where: { id: 'default' } });
  const initialPackageConfig = await request('/admin/agency-package-settings', { headers: adminAuth });
  assert(initialPackageConfig.data.base_price_usd === '25', 'Giá niêm yết gói đại lý không phải 25 USD');
  packageSettingTouched = true;
  const packageConfig = await request('/admin/agency-package-settings', { method: 'PATCH', headers: { ...adminAuth, 'content-type': 'application/json' }, body: JSON.stringify({ usd_vnd_rate: 25000 }) });
  assert(packageConfig.data.unit_price_vnd === '625000', 'Tỷ giá USD/VND chưa được áp dụng vào giá gói');

  const application = await request('/investor/agency/applications', { method: 'POST', headers: { ...applicantAuth, 'content-type': 'application/json' }, body: JSON.stringify({ business_name: 'Mindo Phase 2 Store', tax_code: '0319999921', phone: '0900000021', address: 'Quận 1, TP. Hồ Chí Minh' }) });
  assert(application.data.status === 'PENDING', 'Hồ sơ đại lý không ở trạng thái chờ duyệt');
  const agencyId = application.data.id;
  const agencyCode = application.data.code;
  const listed = await request('/admin/agencies?status=PENDING', { headers: adminAuth });
  assert(listed.data.some((agency) => agency.id === agencyId), 'Admin không thấy hồ sơ đại lý chờ duyệt');
  await request(`/admin/agencies/${agencyId}/review`, { method: 'POST', headers: { ...adminAuth, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'APPROVED', review_note: 'Đạt điều kiện kiểm thử Phase 2' }) });
  const contract = await fetch(`${apiBase}/admin/agencies/${agencyId}/contract`, { headers: adminAuth });
  assert(contract.ok && (await contract.text()).includes('HỢP ĐỒNG ĐẠI LÝ MINDO'), 'Không xuất được hợp đồng đại lý');

  await request('/investor/agency/store', { method: 'PATCH', headers: { ...applicantAuth, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Mindo Phase 2 Store', description: 'Cửa hàng kiểm thử Phase 2 của Mindo', contact_email: applicantEmail, contact_phone: '0900000021', primary_color: '#174EA6' }) });
  const mine = await request('/investor/agency/me', { headers: applicantAuth });
  const publicStore = await request(`/agency-stores/${mine.data.store.slug}`);
  assert(publicStore.data.agency.code === agencyCode, 'Cửa hàng riêng không gắn đúng đại lý');

  const product = publicStore.data.products[0];
  const packagePurchase = await request('/investor/agency/packages', { method: 'POST', headers: { ...applicantAuth, 'content-type': 'application/json' }, body: JSON.stringify({ product_id: product.id, quantity: 50 }) });
  assert(packagePurchase.data.tier === 'TIER_2' && packagePurchase.data.discountRate === '0.3', 'Danh hiệu Đại lý 2 không áp dụng mức 30%');
  assert(packagePurchase.data.unitPriceUsd === '25' && packagePurchase.data.usdVndRate === '25000', 'Giao dịch mua gói không lưu giá USD và tỷ giá');
  assert(packagePurchase.data.netAmountVnd === '24937500', 'Chiết khấu chưa được tính từ đúng gói chạm mốc');
  assert(packagePurchase.data.pricing_breakdown.length === 2 && packagePurchase.data.pricing_breakdown[0].quantity === 49 && packagePurchase.data.pricing_breakdown[1].quantity === 1, 'Mua gói vượt mốc chưa được tách đúng hai bậc giá');

  const quote = await request('/investor/invest/snapshot-price', { method: 'POST', headers: { ...buyerAuth, 'content-type': 'application/json' }, body: JSON.stringify({ nft_id: product.id, amount: 1, payment_type: 'BALANCE' }) });
  const purchase = await request('/investor/invest', { method: 'POST', headers: { ...buyerAuth, 'content-type': 'application/json' }, body: JSON.stringify({ price_snapshot: quote.data.price_snapshot, agency_code: agencyCode }) });
  assert(purchase.data.status === 'COMPLETED' && purchase.data.nftAssets?.[0]?.assetCode?.startsWith('MINDO-'), 'NFT nội bộ chưa được cấp ngay sau thanh toán');
  const repeatedPurchase = await request('/investor/invest', { method: 'POST', headers: { ...buyerAuth, 'content-type': 'application/json' }, body: JSON.stringify({ price_snapshot: quote.data.price_snapshot, agency_code: agencyCode }) });
  assert(repeatedPurchase.data.id === purchase.data.id, 'Gửi lại cùng báo giá đã tạo đơn NFT trùng');
  const [issuedAssets, issuedCommissions, issuedCommission] = await Promise.all([
    prisma.nftAsset.count({ where: { orderId: purchase.data.id } }),
    prisma.agencyCommission.count({ where: { orderId: purchase.data.id } }),
    prisma.agencyCommission.findUnique({ where: { orderId: purchase.data.id }, select: { amountVnd: true, rate: true } }),
  ]);
  assert(issuedAssets === 1 && issuedCommissions === 1, 'NFT hoặc hoa hồng nội bộ bị ghi nhận trùng');
  assert(issuedCommission?.rate.toString() === '0.3' && Number(issuedCommission.amountVnd) === Number(product.unitPriceVnd) * 0.3, 'Hoa hồng sản phẩm chưa dùng mức chiết khấu theo danh hiệu');
  const nftHistory = await request('/investor/history/nfts?status=completed', { headers: buyerAuth });
  const historyPurchase = nftHistory.data.groups.flatMap((group) => group.items).find((item) => item.id === purchase.data.id);
  assert(historyPurchase?.nft_codes?.[0]?.startsWith('MINDO-'), 'Lịch sử chưa trả NFT nội bộ đã cấp');
  const nftDetail = await request(`/investor/history/nfts/${purchase.data.id}`, { headers: buyerAuth });
  assert(nftDetail.data.execution.ownership_system === 'MINDO_INTERNAL', 'Chi tiết NFT không dùng mô hình sở hữu nội bộ');
  assert(nftDetail.data.execution.blockchain_transaction === null, 'Chi tiết NFT vẫn còn dữ liệu blockchain');
  let agencyDashboard;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    agencyDashboard = await request('/investor/agency/dashboard', { headers: applicantAuth });
    if (Number(agencyDashboard.data.metrics.total_commission_vnd) > 0) break;
    await sleep(250);
  }
  assert(agencyDashboard && Number(agencyDashboard.data.metrics.total_commission_vnd) > 0, 'Hoa hồng đại lý chưa được ghi nhận sau khi cấp NFT nội bộ');

  const experts = await request('/ai/experts');
  const conversation = await request('/investor/ai/conversations', { method: 'POST', headers: { ...buyerAuth, 'content-type': 'application/json' }, body: JSON.stringify({ expert_id: experts.data[0].id }) });
  const messages = await request(`/investor/ai/conversations/${conversation.data.id}/messages`, { method: 'POST', headers: { ...buyerAuth, 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Soạn kế hoạch tài chính ngắn', kind: 'DOCUMENT' }) });
  const assistantId = messages.data.assistant_message.id;
  let aiConversation;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    aiConversation = await request(`/investor/ai/conversations/${conversation.data.id}`, { headers: buyerAuth });
    if (aiConversation.data.messages.some((message) => message.id === assistantId && message.status === 'COMPLETED')) break;
    await sleep(250);
  }
  assert(aiConversation?.data.messages.some((message) => message.id === assistantId && message.status === 'COMPLETED'), 'AI queue chưa hoàn thành phản hồi');
  const document = await fetch(`${apiBase}/investor/ai/messages/${assistantId}/document`, { headers: buyerAuth });
  assert(document.ok && (await document.text()).includes('Tài liệu Mindo'), 'Không tải được tài liệu AI');

  const createdAdmin = await request('/admin/accounts', { method: 'POST', headers: { ...adminAuth, 'content-type': 'application/json' }, body: JSON.stringify({ email: adminEmail, full_name: 'Compliance Phase 2', password: 'AdminPhase2!', role: 'COMPLIANCE' }) });
  await request(`/admin/accounts/${createdAdmin.data.id}/role`, { method: 'PATCH', headers: { ...adminAuth, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'FINANCE' }) });
  await request(`/admin/accounts/${createdAdmin.data.id}/reset-password`, { method: 'POST', headers: { ...adminAuth, 'content-type': 'application/json' }, body: JSON.stringify({ password: 'ResetPhase2!' }) });
  await request(`/admin/accounts/${createdAdmin.data.id}`, { method: 'DELETE', headers: adminAuth });

  console.log(JSON.stringify({ agency_application_and_approval: 'passed', one_time_contract: 'passed', private_agency_store: 'passed', configurable_usd_vnd_rate: 'passed', cumulative_package_title_and_discount: 'passed', internal_nft_and_commission_once: 'passed', internal_nft_history: 'passed', ai_queue_and_document: 'passed', admin_rbac_management: 'passed' }, null, 2));
} finally {
  await cleanup();
  await prisma.$disconnect();
}
