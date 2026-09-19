import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const apiBase = process.env.E2E_API_URL ?? 'http://127.0.0.1:4000/api/v1';
const runId = Date.now().toString(36);
const password = 'CallIntegration123!';
const emails = [`call-a-${runId}@mindo.local`, `call-b-${runId}@mindo.local`, `call-c-${runId}@mindo.local`];

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

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
  const userIds = users.map((user) => user.id);
  if (!userIds.length) return;
  await prisma.call.deleteMany({ where: { OR: [{ callerId: { in: userIds } }, { calleeId: { in: userIds } }] } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

try {
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.createMany({ data: emails.map((email, index) => ({
    email,
    passwordHash,
    fullName: `Mindo Call ${index + 1}`,
    emailVerifiedAt: new Date(),
    referralCode: `CALL-${runId}-${index}`,
  })) });
  const users = await prisma.user.findMany({ where: { email: { in: emails } }, orderBy: { email: 'asc' } });
  const byEmail = new Map(users.map((user) => [user.email, user]));
  const caller = byEmail.get(emails[0]);
  const callee = byEmail.get(emails[1]);
  assert(caller && callee, 'Không tạo được người dùng kiểm thử cuộc gọi');
  const callerAuth = await login(emails[0]);
  const calleeAuth = await login(emails[1]);
  const outsiderAuth = await login(emails[2]);

  const appRtm = await request('/investor/calls/rtm-token?client=app', { headers: callerAuth });
  const webRtm = await request('/investor/calls/rtm-token?client=web', { headers: callerAuth });
  assert(
    appRtm.data.rtm_uid === caller.id && webRtm.data.rtm_uid === `${caller.id}_web`,
    `RTM uid app/web chưa được tách: ${JSON.stringify({ caller_id: caller.id, app: appRtm.data, web: webRtm.data })}`,
  );

  const audio = await request('/investor/calls/initiate', {
    method: 'POST',
    headers: { ...callerAuth, 'content-type': 'application/json' },
    body: JSON.stringify({ callee_user_id: callee.id, call_type: 'AUDIO', conversation_id: `conversation-${runId}` }),
  });
  assert(audio.data.call.status === 'RINGING' && audio.data.media.rtc_token, 'Không khởi tạo được audio call');
  const incoming = await request('/investor/calls/incoming', { headers: calleeAuth });
  assert(incoming.data.call_id === audio.data.call.call_id && incoming.data.peer.user_id === caller.id, 'Người nhận không khôi phục được cuộc gọi đến');

  const busy = await fetch(`${apiBase}/investor/calls/initiate`, {
    method: 'POST',
    headers: { ...callerAuth, 'content-type': 'application/json' },
    body: JSON.stringify({ callee_user_id: callee.id, call_type: 'VIDEO' }),
  });
  assert(busy.status === 409, 'Busy guard không chặn cuộc gọi đồng thời');
  await request(`/investor/calls/${audio.data.call.call_id}/reject`, { method: 'POST', headers: calleeAuth });

  const video = await request('/investor/calls/initiate', {
    method: 'POST',
    headers: { ...callerAuth, 'content-type': 'application/json' },
    body: JSON.stringify({ callee_user_id: callee.id, call_type: 'VIDEO', client_platform: 'app' }),
  });
  const accepted = await request(`/investor/calls/${video.data.call.call_id}/accept`, {
    method: 'POST',
    headers: { ...calleeAuth, 'content-type': 'application/json' },
    body: JSON.stringify({ client_platform: 'app' }),
  });
  assert(accepted.data.call.status === 'ACCEPTED' && accepted.data.call.call_type === 'VIDEO', 'Không nhận được video call');
  const refreshed = await request(`/investor/calls/${video.data.call.call_id}/token`, {
    method: 'POST',
    headers: { ...callerAuth, 'content-type': 'application/json' },
    body: JSON.stringify({ client_platform: 'app' }),
  });
  assert(refreshed.data.media.rtc_token, 'Không làm mới được RTC token');

  const outsider = await fetch(`${apiBase}/investor/calls/${video.data.call.call_id}`, { headers: outsiderAuth });
  assert(outsider.status === 403, 'Người ngoài cuộc vẫn đọc được cuộc gọi');
  const ended = await request(`/investor/calls/${video.data.call.call_id}/end`, {
    method: 'POST',
    headers: { ...callerAuth, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert(ended.data.status === 'COMPLETED', 'Không kết thúc được video call');
  const repeatedEnd = await request(`/investor/calls/${video.data.call.call_id}/end`, {
    method: 'POST',
    headers: { ...calleeAuth, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert(repeatedEnd.data.status === 'COMPLETED', 'End call chưa idempotent');

  const unanswered = await request('/investor/calls/initiate', {
    method: 'POST',
    headers: { ...callerAuth, 'content-type': 'application/json' },
    body: JSON.stringify({ callee_user_id: callee.id, call_type: 'AUDIO' }),
  });
  await new Promise((resolve) => setTimeout(resolve, 17_000));
  const missed = await request(`/investor/calls/${unanswered.data.call.call_id}`, { headers: calleeAuth });
  assert(missed.data.status === 'MISSED', 'Timeout không chuyển cuộc gọi không trả lời thành MISSED');

  const history = await request('/investor/calls/history?limit=10', { headers: callerAuth });
  assert(
    history.data.length === 3
      && history.data.some((call) => call.call_type === 'VIDEO')
      && history.data.some((call) => call.status === 'MISSED'),
    'Lịch sử cuộc gọi chưa đầy đủ',
  );

  console.log(JSON.stringify({
    agora_rtc_rtm_tokens: 'passed',
    app_web_rtm_uid_isolation: 'passed',
    audio_call_reject: 'passed',
    video_call_accept_refresh_end: 'passed',
    concurrent_call_guard: 'passed',
    participant_authorization: 'passed',
    unanswered_call_timeout: 'passed',
    call_history: 'passed',
  }, null, 2));
} finally {
  await cleanup();
  await prisma.$disconnect();
}
