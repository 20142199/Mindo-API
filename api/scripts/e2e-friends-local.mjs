import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const apiBase = process.env.E2E_API_URL ?? 'http://127.0.0.1:4000/api/v1';
const runId = Date.now().toString(36);
const password = 'FriendIntegration123!';
const usersToCreate = [
  { email: `friend-a-${runId}@mindo.local`, fullName: 'Mindo Friend A', phone: '0901234501' },
  { email: `friend-b-${runId}@mindo.local`, fullName: 'Mindo Friend B', phone: '0901234502' },
  { email: `friend-c-${runId}@mindo.local`, fullName: 'Mindo Friend C', phone: null },
];
const emails = usersToCreate.map((user) => user.email);

const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, options);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${path} -> ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  return body;
}

async function login(email) {
  const response = await request('/investor/auth/login/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { authorization: `Bearer ${response.data.access_token}` };
}

async function send(identifier, auth) {
  return request('/investor/friends/requests', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ identifier }),
  });
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
  const ids = users.map((user) => user.id);
  if (!ids.length) return;
  await prisma.friendRequest.deleteMany({ where: { OR: [{ requesterId: { in: ids } }, { recipientId: { in: ids } }] } });
  await prisma.friendship.deleteMany({ where: { OR: [{ userId: { in: ids } }, { friendUserId: { in: ids } }] } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

try {
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.createMany({
    data: usersToCreate.map((user, index) => ({
      email: user.email,
      passwordHash,
      fullName: user.fullName,
      phone: user.phone,
      phoneNormalized: user.phone,
      emailVerifiedAt: new Date(),
      referralCode: `FRIEND-${runId}-${index}`,
    })),
  });
  const rows = await prisma.user.findMany({ where: { email: { in: emails } } });
  const byEmail = new Map(rows.map((user) => [user.email, user]));
  const userA = byEmail.get(emails[0]);
  const userB = byEmail.get(emails[1]);
  const userC = byEmail.get(emails[2]);
  assert(userA && userB && userC, 'Không tạo được tài khoản kiểm thử bạn bè');
  const authA = await login(userA.email);
  const authB = await login(userB.email);
  const authC = await login(userC.email);
  await request('/investor/account/profile', {
    method: 'PATCH',
    headers: { ...authC, 'content-type': 'application/json' },
    body: JSON.stringify({ phone_number: '(+84) 901 234 503' }),
  });

  const sentByEmail = await send(`  ${userB.email.toUpperCase()}  `, authA);
  assert(sentByEmail.data.user.user_id === userB.id && sentByEmail.data.direction === 'outgoing', 'Không gửi được lời mời bằng email');
  const incoming = await request('/investor/friends/requests?direction=incoming', { headers: authB });
  assert(incoming.data.length === 1 && incoming.data[0].user.user_id === userA.id, 'Danh sách lời mời đến không đúng');

  const duplicate = await fetch(`${apiBase}/investor/friends/requests`, {
    method: 'POST',
    headers: { ...authA, 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: userB.email }),
  });
  assert(duplicate.status === 409, 'Không chặn lời mời trùng');
  const reverse = await fetch(`${apiBase}/investor/friends/requests`, {
    method: 'POST',
    headers: { ...authB, 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: userA.email }),
  });
  assert(reverse.status === 409, 'Không phát hiện lời mời chiều ngược lại');
  const unauthorizedAccept = await fetch(`${apiBase}/investor/friends/requests/${userA.id}/accept`, { method: 'POST', headers: authC });
  assert(unauthorizedAccept.status === 404, 'Tài khoản ngoài lời mời vẫn chấp nhận được');

  await request(`/investor/friends/requests/${userA.id}/accept`, { method: 'POST', headers: authB });
  const [friendsA, friendsB] = await Promise.all([
    request('/investor/friends', { headers: authA }),
    request('/investor/friends', { headers: authB }),
  ]);
  assert(friendsA.data[0].user_id === userB.id && friendsB.data[0].user_id === userA.id, 'Quan hệ bạn bè hai chiều không đúng');
  assert(friendsA.data[0].email === userB.email, 'Danh sách bạn bè thiếu thông tin liên hệ');

  await request(`/investor/friends/${userB.id}`, { method: 'DELETE', headers: authA });
  const afterRemove = await request('/investor/friends', { headers: authB });
  assert(afterRemove.data.length === 0, 'Xóa bạn chưa xóa cả hai chiều');

  const sentByPhone = await send('(+84) 901 234 503', authA);
  assert(sentByPhone.data.user.user_id === userC.id, 'Không tìm đúng user_id bằng số điện thoại chuẩn hóa');
  await request(`/investor/friends/requests/${userC.id}`, { method: 'DELETE', headers: authA });
  const outgoingAfterCancel = await request('/investor/friends/requests?direction=outgoing', { headers: authA });
  assert(outgoingAfterCancel.data.length === 0, 'Hủy lời mời chưa thành công');

  await send(userA.phone, authC);
  await request(`/investor/friends/requests/${userC.id}/reject`, { method: 'POST', headers: authA });
  const incomingAfterReject = await request('/investor/friends/requests?direction=incoming', { headers: authA });
  assert(incomingAfterReject.data.length === 0, 'Từ chối lời mời chưa thành công');

  const self = await fetch(`${apiBase}/investor/friends/requests`, {
    method: 'POST',
    headers: { ...authA, 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: userA.email }),
  });
  assert(self.status === 400, 'Không chặn tự kết bạn');

  console.log(JSON.stringify({
    add_by_email: 'passed',
    add_by_phone_normalization: 'passed',
    duplicate_and_reverse_guard: 'passed',
    request_authorization: 'passed',
    accept_and_bidirectional_friendship: 'passed',
    cancel_reject_remove: 'passed',
    user_id_primary_relations: 'passed',
  }, null, 2));
} finally {
  await cleanup();
  await prisma.$disconnect();
}
