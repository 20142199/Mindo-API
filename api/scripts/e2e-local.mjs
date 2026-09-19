import { PrismaClient } from '@prisma/client';
import { rm } from 'node:fs/promises';
import path from 'node:path';

const prisma = new PrismaClient();
const apiBase = process.env.E2E_API_URL ?? 'http://127.0.0.1:4000/api/v1';
const apiOrigin = process.env.E2E_API_ORIGIN ?? 'http://127.0.0.1:4000';
const mailpitBase = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:8025';
const bankAccount = process.env.E2E_VIETQR_BANK_ACCOUNT ?? '123456789';
const callbackUsername = process.env.E2E_VIETQR_CALLBACK_USERNAME ?? 'mindo-vietqr';
const callbackPassword = process.env.E2E_VIETQR_CALLBACK_PASSWORD ?? 'integration-callback-password';
const runId = Date.now().toString(36);
const email = `otp-test-${runId}@mindo.local`;
const initialPassword = 'Integration123!';
const resetPassword = 'MindoReset456!';
let userId;
let adminUserId;
let adminTokenIdsBefore = new Set();

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function request(pathname, options = {}) {
  const response = await fetch(`${apiBase}${pathname}`, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const safeBody = typeof body === 'object' ? JSON.stringify(body) : String(body);
    throw new Error(`${options.method ?? 'GET'} ${pathname} -> ${response.status}: ${safeBody}`);
  }
  return body;
}

async function findOtp(subject) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const listResponse = await fetch(`${mailpitBase}/api/v1/messages`);
    assert(listResponse.ok, `Mailpit list -> ${listResponse.status}`);
    const list = await listResponse.json();
    const message = list.messages?.find((item) => {
      const recipients = [...(item.To ?? []), ...(item.Cc ?? [])];
      return item.Subject === subject && recipients.some((recipient) => recipient.Address === email);
    });
    if (message) {
      const detailResponse = await fetch(`${mailpitBase}/api/v1/message/${message.ID}`);
      assert(detailResponse.ok, `Mailpit detail -> ${detailResponse.status}`);
      const detail = await detailResponse.json();
      const content = [detail.Text, detail.HTML, detail.Snippet, message.Snippet].filter(Boolean).join(' ');
      const match = content.match(/\b(\d{6})\b/);
      if (match) return match[1];
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Không tìm thấy OTP trong Mailpit');
}

async function cleanup() {
  const user = await prisma.user.findUnique({ where: { email } });
  await prisma.verificationCode.deleteMany({ where: { email } });
  if (!user) return;
  const deposits = await prisma.deposit.findMany({ where: { userId: user.id }, select: { id: true } });
  const kycSubmissions = await prisma.kycSubmission.findMany({ where: { userId: user.id }, select: { id: true } });
  const depositIds = deposits.map((deposit) => deposit.id);
  const kycIds = kycSubmissions.map((submission) => submission.id);
  if (depositIds.length) {
    await prisma.auditLog.deleteMany({ where: { entityType: 'Deposit', entityId: { in: depositIds } } });
  }
  if (kycIds.length) {
    await prisma.auditLog.deleteMany({ where: { entityType: 'KycSubmission', entityId: { in: kycIds } } });
  }
  await prisma.ledgerEntry.deleteMany({ where: { userId: user.id } });
  await prisma.deposit.deleteMany({ where: { userId: user.id } });
  await prisma.auditLog.deleteMany({ where: { actorId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  const storageRoot = path.resolve(process.cwd(), 'storage/kyc', user.id);
  await rm(storageRoot, { recursive: true, force: true });
  if (adminUserId) {
    const currentTokens = await prisma.refreshToken.findMany({ where: { userId: adminUserId }, select: { id: true } });
    const createdTokenIds = currentTokens.map((token) => token.id).filter((id) => !adminTokenIdsBefore.has(id));
    if (createdTokenIds.length) await prisma.refreshToken.deleteMany({ where: { id: { in: createdTokenIds } } });
  }
}

try {
  const registration = await request('/investor/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: initialPassword,
      confirm_password: initialPassword,
      full_name: 'Mindo Integration',
      accept_terms: true,
    }),
  });
  userId = registration.data.user.id;
  assert(registration.data.verification_required === true, 'Đăng ký chưa yêu cầu xác thực email');

  const otp = await findOtp('Mã xác nhận tài khoản Mindo');
  await request('/investor/auth/verify-account', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, otp }),
  });

  const login = await request('/investor/auth/login/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: initialPassword, remember_me: true }),
  });
  assert(login.data.access_token, 'Đăng nhập không trả access token');

  await request('/investor/auth/forgot-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const resetOtp = await findOtp('Mã đặt lại mật khẩu Mindo');
  const verifiedReset = await request('/investor/auth/forgot-password/verify-otp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, otp: resetOtp }),
  });
  assert(verifiedReset.data.reset_token, 'Xác thực OTP không trả reset token');
  const resetBody = {
    reset_token: verifiedReset.data.reset_token,
    new_password: resetPassword,
    confirm_password: resetPassword,
  };
  await request('/investor/auth/reset-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(resetBody),
  });
  const replayResponse = await fetch(`${apiBase}/investor/auth/reset-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(resetBody),
  });
  assert(replayResponse.status === 400, 'Reset token đã dùng vẫn có thể dùng lại');

  const loginAfterReset = await request('/investor/auth/login/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: resetPassword,
      device_info: 'iPhone - Mindo E2E',
      device_type: 'mobile',
      device_location: 'Hồ Chí Minh',
    }),
  });
  const token = loginAfterReset.data.access_token;
  assert(token, 'Đăng nhập không trả access token');
  const authorization = { authorization: `Bearer ${token}` };

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const upload = async (name) => {
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), name);
    return request('/investor/files/upload', { method: 'POST', headers: authorization, body: form });
  };
  const front = await upload('mindo-id-front.png');
  const back = await upload('mindo-id-back.png');
  const selfie = await upload('mindo-selfie.png');
  const avatar = await upload('mindo-avatar.png');
  assert(front.data.visibility === 'private' && back.data.visibility === 'private' && selfie.data.visibility === 'private', 'File KYC chưa ở chế độ private');
  const signedFileResponse = await fetch(front.data.public_url);
  assert(signedFileResponse.ok && signedFileResponse.headers.get('content-type') === 'image/png', 'Signed URL file KYC không đọc được');

  const updatedAccount = await request('/investor/account/profile', {
    method: 'PATCH',
    headers: { ...authorization, 'content-type': 'application/json' },
    body: JSON.stringify({
      full_name: 'Mindo Integration',
      phone_number: '(+84) 900 000 001',
      address: 'Thành phố Hồ Chí Minh',
      avatar_file_id: avatar.data.id,
    }),
  });
  assert(updatedAccount.data.avatar_file_id === avatar.data.id, 'Avatar tài khoản chưa được cập nhật');

  const settings = await request('/investor/account/settings', {
    method: 'PATCH',
    headers: { ...authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ language: 'vi', suspicious_login_alerts: true, email_notifications: false }),
  });
  assert(settings.data.language === 'vi' && settings.data.email_notifications === false, 'Cài đặt tài khoản chưa được lưu');
  const sessions = await request('/investor/account/sessions', { headers: authorization });
  assert(sessions.data.some((session) => session.is_current && session.device_type === 'mobile'), 'Phiên đăng nhập hiện tại chưa hiển thị đúng');

  await request('/investor/kyc/submissions', {
    method: 'POST',
    headers: { ...authorization, 'content-type': 'application/json' },
    body: JSON.stringify({
      full_name: 'Mindo Integration',
      email,
      phone_number: '0900000001',
      address: 'Thành phố Hồ Chí Minh',
      bank_account_name: 'MINDO INTEGRATION',
      bank_account_number: '0301000456845',
      bank_name: 'Vietcombank',
      id_front_file_id: front.data.id,
      id_back_file_id: back.data.id,
      selfie_file_id: selfie.data.id,
    }),
  });
  const kyc = await request('/investor/kyc/submissions/me', { headers: authorization });
  assert(kyc.data.status === 'PENDING', 'Hồ sơ KYC không ở trạng thái chờ Admin duyệt');
  assert(kyc.data.id_front_file?.visibility === 'private', 'Hồ sơ KYC không trả file private');
  assert(kyc.data.selfie_file?.visibility === 'private', 'Hồ sơ KYC không trả ảnh selfie private');
  const accountWithPendingKyc = await request('/investor/account', { headers: authorization });
  assert(accountWithPendingKyc.data.kyc.status === 'pending', 'Trang tài khoản chưa trả trạng thái KYC đang chờ duyệt');
  assert(accountWithPendingKyc.data.bank_account.account_number === '0301000456845', 'Trang tài khoản chưa trả thông tin ngân hàng');

  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@local.test' } });
  adminUserId = admin.id;
  adminTokenIdsBefore = new Set((await prisma.refreshToken.findMany({ where: { userId: admin.id }, select: { id: true } })).map((token) => token.id));
  const adminLogin = await request('/admin/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@local.test', password: 'ChangeMe123!' }),
  });
  const adminAuthorization = { authorization: `Bearer ${adminLogin.data.access_token}` };
  const adminKyc = await request('/admin/kyc', { headers: adminAuthorization });
  const uploadedKyc = adminKyc.data.find((submission) => submission.userId === userId);
  assert(uploadedKyc?.idFrontFileUrl, 'Admin không xem được file KYC đã tải lên');
  await request(`/admin/kyc/${uploadedKyc.id}/review`, {
    method: 'POST',
    headers: { ...adminAuthorization, 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'APPROVED', review_note: 'Duyệt tự động trong kiểm thử tích hợp' }),
  });
  const approvedProfile = await request('/investor/me', { headers: authorization });
  assert(approvedProfile.data.kyc_status === 'approved', 'Admin duyệt nhưng trạng thái KYC người dùng chưa cập nhật');

  const deposit = await request('/investor/deposits', {
    method: 'POST',
    headers: { ...authorization, 'content-type': 'application/json', 'idempotency-key': `e2e-${runId}` },
    body: JSON.stringify({ amount_vnd: '100000' }),
  });
  assert(deposit.data.vietqr?.qr_code, 'Lệnh nạp chưa có mã VietQR');
  assert(deposit.data.vietqr?.order_id, 'Lệnh nạp chưa có VietQR order ID');

  const transactionId = `E2E-${runId}`;
  const callbackBody = {
    bankaccount: bankAccount,
    amount: 100000,
    transType: 'C',
    content: deposit.data.transferCode,
    transactionid: transactionId,
    transactiontime: Date.now(),
    referencenumber: `REF-${runId}`,
    orderId: deposit.data.vietqr.order_id,
  };
  const tokenResponse = await fetch(`${apiOrigin}/vqr/api/token_generate`, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${callbackUsername}:${callbackPassword}`).toString('base64')}` },
  });
  assert(tokenResponse.ok, `VietQR token_generate -> ${tokenResponse.status}`);
  const callbackToken = await tokenResponse.json();
  assert(callbackToken.access_token && callbackToken.token_type === 'Bearer', 'API không cấp Bearer token cho VietQR');
  const callbackOptions = {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${callbackToken.access_token}` },
    body: JSON.stringify(callbackBody),
  };
  const callback = async () => {
    const response = await fetch(`${apiOrigin}/vqr/bank/api/transaction-sync`, callbackOptions);
    const body = await response.json();
    if (!response.ok) throw new Error(`VietQR transaction-sync -> ${response.status}: ${JSON.stringify(body)}`);
    return body;
  };
  const firstCallback = await callback();
  const secondCallback = await callback();
  assert(firstCallback.error === false && secondCallback.error === false, 'Webhook VietQR chưa idempotent');

  const profile = await request('/investor/me', { headers: authorization });
  assert(profile.data.balance_vnd === '100000', `Số dư sau VietQR không đúng: ${profile.data.balance_vnd}`);

  const depositHistory = await request('/investor/history/deposits?status=completed&source=VIETQR', { headers: authorization });
  const historyDeposit = depositHistory.data.groups.flatMap((group) => group.items).find((item) => item.id === deposit.data.id);
  assert(historyDeposit?.status === 'completed', 'Lịch sử nạp tiền chưa ghi nhận giao dịch VietQR thành công');
  assert(depositHistory.data.summary.total_deposited_vnd === '100000', 'Tổng tiền đã nạp trong lịch sử không đúng');
  const depositDetail = await request(`/investor/history/deposits/${deposit.data.id}`, { headers: authorization });
  assert(depositDetail.data.wallet_credit.balance_before_vnd === '0', 'Chi tiết nạp tiền thiếu số dư trước nạp');
  assert(depositDetail.data.wallet_credit.balance_after_vnd === '100000', 'Chi tiết nạp tiền thiếu số dư sau nạp');
  const receipt = await fetch(`${apiBase}/investor/history/deposits/${deposit.data.id}/receipt`, { headers: authorization });
  assert(receipt.ok && (await receipt.text()).includes('BIÊN LAI NẠP TIỀN MINDO'), 'Không tải được biên lai nạp tiền');

  console.log(JSON.stringify({
    registration_email_otp: 'passed',
    login_email_password: 'passed',
    password_reset_otp: 'passed',
    password_reset_single_use_token: 'passed',
    account_profile_avatar: 'passed',
    account_settings: 'passed',
    account_sessions: 'passed',
    private_kyc_upload: 'passed',
    kyc_bank_and_selfie: 'passed',
    manual_admin_kyc_approval: 'passed',
    vietqr_generation: 'passed',
    vietqr_bearer_auth: 'passed',
    vietqr_webhook_idempotency: 'passed',
    deposit_history_detail_receipt: 'passed',
    credited_balance_vnd: profile.data.balance_vnd,
  }, null, 2));
} finally {
  await cleanup();
  await prisma.$disconnect();
}
