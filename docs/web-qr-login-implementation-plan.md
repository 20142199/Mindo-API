# Đăng nhập web bằng QR — kế hoạch triển khai

Spec: [`web-qr-login-design.md`](web-qr-login-design.md). Làm theo thứ tự; mỗi
bước kết thúc bằng lệnh kiểm chứng. Commit tiếng Anh, không dòng ghi công.

**Thứ tự merge:** API trước (web và app đều gọi endpoint mới), rồi App. Web
không có remote — sửa tại chỗ, để nguyên chưa commit.

Đường dẫn:
- API: `/Users/Work_home/Project_Hungs/Mindo/Mindo-API` (nhánh `feat/web-qr-login`)
- Web: `/Users/Work_home/Project_Hungs/Mindo/Mindo-Web`
- App: `/Users/Work_home/Project_Hungs/Mindo/Mindo-App` (nhánh `feat/web-qr-login`)

---

## Phần A — API

### A1. Schema + migration

`api/prisma/schema.prisma` — thêm enum và model, thêm quan hệ ngược vào `User`
(`webLoginRequests WebLoginRequest[]`, cạnh `refreshTokens`):

```prisma
enum WebLoginStatus {
  PENDING
  SCANNED
  APPROVED
  REJECTED
  CONSUMED
}

/// Yêu cầu đăng nhập web bằng mã QR — xem docs/web-qr-login-design.md.
/// Chỉ `id` nằm trong QR; khoá bí mật chỉ lưu dạng băm.
model WebLoginRequest {
  id         String         @id
  secretHash String
  status     WebLoginStatus @default(PENDING)
  userId     String?
  browser    String?
  ipAddress  String?
  expiresAt  DateTime
  createdAt  DateTime       @default(now())
  scannedAt  DateTime?
  decidedAt  DateTime?
  user       User?          @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([expiresAt])
}
```

Sinh SQL bằng diff (không đụng DB dev):

```bash
cd api
git show HEAD:api/prisma/schema.prisma > /tmp/schema.before.prisma
mkdir -p prisma/migrations/202609270008_web_login_request
npx prisma migrate diff --from-schema-datamodel /tmp/schema.before.prisma \
  --to-schema-datamodel prisma/schema.prisma --script \
  > prisma/migrations/202609270008_web_login_request/migration.sql
npx prisma generate
```

Kiểm: `migration.sql` chỉ tạo `WebLoginStatus`, `WebLoginRequest`, index và
khoá ngoại — không động gì bảng khác. Áp lên DB dev: `npx prisma migrate deploy`.

### A2. Mô tả trình duyệt từ user-agent (TDD)

`api/src/auth/web-login.browser.test.ts` — viết trước, chạy thấy đỏ:

```ts
import { describe, expect, it } from 'vitest';
import { describeBrowser } from './web-login.browser';

describe('describeBrowser', () => {
  it.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36', 'Chrome trên macOS'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0', 'Edge trên Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15', 'Safari trên macOS'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', 'Firefox trên Linux'],
  ])('%s', (ua, expected) => expect(describeBrowser(ua)).toBe(expected));

  it('không đọc được thì trả câu chung', () => {
    expect(describeBrowser(undefined)).toBe('Trình duyệt web');
    expect(describeBrowser('curl/8.4')).toBe('Trình duyệt web');
  });
});
```

`api/src/auth/web-login.browser.ts`:

```ts
/**
 * "Chrome trên macOS" từ user-agent — chỉ để người dùng nhận ra máy của mình
 * trên màn xác nhận. User-agent do trình duyệt tự khai, nên đây là gợi ý chứ
 * không phải bằng chứng; xem mô hình an toàn trong spec.
 *
 * Thứ tự dò quan trọng: UA của Edge chứa cả "Chrome", UA của Chrome chứa cả
 * "Safari".
 */
const BROWSERS: [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Version\/[\d.]+ .*Safari\//, 'Safari'],
];
const SYSTEMS: [RegExp, string][] = [
  [/Windows NT/, 'Windows'],
  [/iPhone|iPad/, 'iOS'],
  [/Mac OS X/, 'macOS'],
  [/Android/, 'Android'],
  [/Linux/, 'Linux'],
];

export function describeBrowser(userAgent?: string | null): string {
  if (!userAgent) return 'Trình duyệt web';
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(userAgent))?.[1];
  if (!browser) return 'Trình duyệt web';
  return system ? `${browser} trên ${system}` : browser;
}
```

Kiểm: `npx vitest run src/auth/web-login.browser.test.ts` xanh.

### A3. `WebLoginService` (TDD)

`AuthService` — thêm cửa công khai, không đổi `issueTokens`:

```ts
/** Cấp phiên web cho yêu cầu QR đã duyệt — cùng đường với đăng nhập mật khẩu. */
issueWebSession(user: User, context: SessionContext) {
  return this.issueTokens(user, context);
}
```

`api/src/auth/web-login.service.test.ts` — viết trước. Prisma giả trong bộ nhớ
thực thi đúng `where` của `updateMany` (id, status, userId, `expiresAt.gt`), để
các ca tranh chấp chạy thật:

```ts
import { ConflictException, GoneException, NotFoundException } from '@nestjs/common';
import { WebLoginStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../common/prisma.module';
import { AuthService } from './auth.service';
import { WebLoginService } from './web-login.service';

type Row = {
  id: string; secretHash: string; status: WebLoginStatus; userId: string | null;
  browser: string | null; ipAddress: string | null; expiresAt: Date; createdAt: Date;
  scannedAt: Date | null; decidedAt: Date | null;
};

function build(users: Record<string, { status: string }> = { me: { status: 'ACTIVE' }, other: { status: 'ACTIVE' } }) {
  const rows = new Map<string, Row>();
  const matches = (row: Row, where: Record<string, any>) =>
    Object.entries(where).every(([key, value]) =>
      key === 'expiresAt' ? row.expiresAt > value.gt : (row as any)[key] === value);
  const prisma = {
    webLoginRequest: {
      create: vi.fn(({ data }) => {
        const row: Row = { status: 'PENDING', userId: null, createdAt: new Date(), scannedAt: null, decidedAt: null, browser: null, ipAddress: null, ...data };
        rows.set(row.id, row);
        return Promise.resolve(row);
      }),
      findUnique: vi.fn(({ where }) => Promise.resolve(rows.get(where.id) ?? null)),
      updateMany: vi.fn(({ where, data }) => {
        const row = rows.get(where.id);
        if (!row || !matches(row, where)) return Promise.resolve({ count: 0 });
        Object.assign(row, data);
        return Promise.resolve({ count: 1 });
      }),
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
    },
    user: { findUnique: vi.fn(({ where }) => Promise.resolve(users[where.id] ? { id: where.id, ...users[where.id] } : null)) },
  } as unknown as PrismaService;
  const issueWebSession = vi.fn(() => Promise.resolve({ user: {}, access_token: 'at', refresh_token: 'rt', session_id: 'sid' }));
  const service = new WebLoginService(prisma, { issueWebSession } as unknown as AuthService);
  return { service, rows, issueWebSession };
}

const expire = (rows: Map<string, Row>, id: string) => { rows.get(id)!.expiresAt = new Date(Date.now() - 1); };

describe('WebLoginService', () => {
  it('tạo mã: QR chỉ chứa id, khoá không lưu nguyên văn', async () => {
    const { service, rows } = build();
    const created = await service.create({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/129.0 Safari/537.36' });
    expect(created.qr_value).toBe(`mindo://web-login?session=${created.session_id}`);
    expect(created.qr_value).not.toContain(created.secret);
    expect(rows.get(created.session_id)!.secretHash).not.toBe(created.secret);
    expect(rows.get(created.session_id)!.browser).toBe('Chrome trên macOS');
  });

  it('sai khoá thì như không tồn tại', async () => {
    const { service } = build();
    const { session_id } = await service.create({});
    await expect(service.poll(session_id, 'sai', {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('chờ quét → đã quét → duyệt → web nhận token đúng MỘT lần', async () => {
    const { service, issueWebSession } = build();
    const { session_id, secret } = await service.create({});
    expect(await service.poll(session_id, secret, {})).toEqual({ status: 'pending' });
    await service.scan('me', session_id);
    expect(await service.poll(session_id, secret, {})).toEqual({ status: 'scanned' });
    await service.decide('me', session_id, true);
    expect(await service.poll(session_id, secret, {})).toMatchObject({ status: 'approved', access_token: 'at' });
    expect(await service.poll(session_id, secret, {})).toEqual({ status: 'expired' });
    expect(issueWebSession).toHaveBeenCalledTimes(1);
  });

  it('hai lần poll cùng lúc sau khi duyệt chỉ một bên có token', async () => {
    const { service, issueWebSession } = build();
    const { session_id, secret } = await service.create({});
    await service.scan('me', session_id);
    await service.decide('me', session_id, true);
    const results = await Promise.all([service.poll(session_id, secret, {}), service.poll(session_id, secret, {})]);
    expect(results.filter((r) => r.status === 'approved')).toHaveLength(1);
    expect(issueWebSession).toHaveBeenCalledTimes(1);
  });

  it('từ chối thì web thấy rejected', async () => {
    const { service } = build();
    const { session_id, secret } = await service.create({});
    await service.scan('me', session_id);
    await service.decide('me', session_id, false);
    expect(await service.poll(session_id, secret, {})).toEqual({ status: 'rejected' });
  });

  it('người khác đã quét trước → 409; người khác duyệt hộ → không được', async () => {
    const { service } = build();
    const { session_id } = await service.create({});
    await service.scan('me', session_id);
    await expect(service.scan('other', session_id)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.decide('other', session_id, true)).rejects.toBeInstanceOf(GoneException);
  });

  it('cùng người quét lại thì trả lại thông tin, không lỗi', async () => {
    const { service } = build();
    const { session_id } = await service.create({});
    const first = await service.scan('me', session_id);
    expect(await service.scan('me', session_id)).toEqual(first);
  });

  it('hết hạn: poll báo expired, quét báo 410', async () => {
    const { service, rows } = build();
    const { session_id, secret } = await service.create({});
    expire(rows, session_id);
    expect(await service.poll(session_id, secret, {})).toEqual({ status: 'expired' });
    await expect(service.scan('me', session_id)).rejects.toBeInstanceOf(GoneException);
  });

  it('quét thì nới hạn để kịp xác nhận', async () => {
    const { service, rows } = build();
    const { session_id } = await service.create({});
    rows.get(session_id)!.expiresAt = new Date(Date.now() + 5_000);
    await service.scan('me', session_id);
    expect(rows.get(session_id)!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 50_000);
  });

  it('tài khoản không còn ACTIVE lúc nhận token thì không cấp', async () => {
    const { service, issueWebSession } = build({ me: { status: 'LOCKED' } });
    const { session_id, secret } = await service.create({});
    await service.scan('me', session_id);
    await service.decide('me', session_id, true);
    expect(await service.poll(session_id, secret, {})).toEqual({ status: 'rejected' });
    expect(issueWebSession).not.toHaveBeenCalled();
  });
});
```

`api/src/auth/web-login.service.ts`:

```ts
import { ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { UserStatus, WebLoginStatus } from '@prisma/client';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { PrismaService } from '../common/prisma.module';
import { AuthService } from './auth.service';
import { describeBrowser } from './web-login.browser';

/** Mã sống 60 giây; quét thì cho thêm 60 giây để kịp bấm xác nhận. */
const QR_TTL_MS = 60_000;
const DAY_MS = 86_400_000;

const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

type WebContext = { userAgent?: string; ipAddress?: string; deviceInfo?: string };

const notFound = () => new NotFoundException({ message: 'Không tìm thấy mã đăng nhập', code: 'QR_NOT_FOUND' });
const expired = () => new GoneException({ message: 'Mã đăng nhập đã hết hạn', code: 'QR_EXPIRED' });

@Injectable()
export class WebLoginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async create(context: WebContext) {
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + QR_TTL_MS);
    await this.prisma.webLoginRequest.create({
      data: {
        id,
        secretHash: hash(secret),
        browser: describeBrowser(context.deviceInfo ?? context.userAgent),
        ipAddress: context.ipAddress,
        expiresAt,
      },
    });
    /* Dọn yêu cầu cũ hơn một ngày — rẻ, và không cần tiến trình riêng */
    void this.prisma.webLoginRequest
      .deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - DAY_MS) } } })
      .catch(() => undefined);
    return { session_id: id, secret, qr_value: `mindo://web-login?session=${id}`, expires_at: expiresAt.toISOString() };
  }

  async poll(id: string, secret: string, context: WebContext) {
    const row = await this.prisma.webLoginRequest.findUnique({ where: { id } });
    /* Sai khoá trả y như không tồn tại: không để lộ rằng id có thật */
    if (!row || !sameHash(row.secretHash, hash(secret))) throw notFound();
    if (row.status === WebLoginStatus.REJECTED) return { status: 'rejected' as const };
    if (row.status === WebLoginStatus.CONSUMED) return { status: 'expired' as const };
    if (row.status === WebLoginStatus.APPROVED) {
      /* Đổi sang CONSUMED trước, cấp token sau: hai lần poll cùng lúc thì chỉ
         một bên đổi được hàng, nên không bao giờ cấp hai phiên từ một mã. */
      const claimed = await this.prisma.webLoginRequest.updateMany({
        where: { id, status: WebLoginStatus.APPROVED, expiresAt: { gt: new Date() } },
        data: { status: WebLoginStatus.CONSUMED },
      });
      if (claimed.count !== 1 || !row.userId) return { status: 'expired' as const };
      const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
      if (!user || user.status !== UserStatus.ACTIVE) return { status: 'rejected' as const };
      const tokens = await this.auth.issueWebSession(user, {
        deviceInfo: row.browser ?? undefined,
        deviceType: 'desktop',
        userAgent: context.userAgent,
        ipAddress: row.ipAddress ?? undefined,
      });
      return { status: 'approved' as const, ...tokens };
    }
    if (row.expiresAt <= new Date()) return { status: 'expired' as const };
    return { status: row.status === WebLoginStatus.SCANNED ? ('scanned' as const) : ('pending' as const) };
  }

  async scan(userId: string, id: string) {
    const now = new Date();
    const claimed = await this.prisma.webLoginRequest.updateMany({
      where: { id, status: WebLoginStatus.PENDING, expiresAt: { gt: now } },
      data: { status: WebLoginStatus.SCANNED, userId, scannedAt: now, expiresAt: new Date(now.getTime() + QR_TTL_MS) },
    });
    const row = await this.prisma.webLoginRequest.findUnique({ where: { id } });
    if (!row) throw notFound();
    if (claimed.count === 0) {
      const sameScanner = row.status === WebLoginStatus.SCANNED && row.userId === userId && row.expiresAt > now;
      if (!sameScanner) {
        if (row.userId && row.userId !== userId) {
          throw new ConflictException({ message: 'Mã này đã được quét bằng tài khoản khác', code: 'QR_ALREADY_SCANNED' });
        }
        throw expired();
      }
    }
    return { browser: row.browser, ip_address: row.ipAddress, created_at: row.createdAt.toISOString() };
  }

  async decide(userId: string, id: string, approve: boolean) {
    const now = new Date();
    const changed = await this.prisma.webLoginRequest.updateMany({
      /* `userId` trong điều kiện: chỉ đúng người đã quét mới quyết định được */
      where: { id, userId, status: WebLoginStatus.SCANNED, expiresAt: { gt: now } },
      data: { status: approve ? WebLoginStatus.APPROVED : WebLoginStatus.REJECTED, decidedAt: now },
    });
    if (changed.count !== 1) throw expired();
    return { status: approve ? ('approved' as const) : ('rejected' as const) };
  }
}
```

Kiểm: `npx vitest run src/auth/web-login.service.test.ts` — đỏ trước khi có
service, xanh sau.

### A4. DTO + controller + module

`api/src/auth/auth.dto.ts` — thêm:

```ts
export class CreateWebLoginDto {
  @IsOptional() @IsString() @MaxLength(255) device_info?: string;
}
export class PollWebLoginDto {
  @IsString() @Length(16, 128) secret!: string;
}
```

`api/src/auth/web-login.controller.ts`:

```ts
@ApiTags('Authentication')
@Controller('api/v1/investor/auth/qr')
export class WebLoginController {
  constructor(private readonly webLogin: WebLoginService) {}

  private context(req: Request) {
    return { ipAddress: req.ip || req.socket.remoteAddress, userAgent: req.headers['user-agent'] };
  }

  @Post() create(@Req() req: Request, @Body() dto: CreateWebLoginDto) {
    return this.webLogin.create({ ...this.context(req), deviceInfo: dto.device_info }).then((data) => ok(data));
  }

  @Post(':id/poll')
  poll(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: PollWebLoginDto) {
    return this.webLogin.poll(id, dto.secret, this.context(req)).then((data) => ok(data));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post(':id/scan')
  scan(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.webLogin.scan(authUser(req).id, id).then((data) => ok(data));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post(':id/approve')
  approve(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.webLogin.decide(authUser(req).id, id, true).then((data) => ok(data, 'Đã đăng nhập trên máy tính'));
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post(':id/reject')
  reject(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.webLogin.decide(authUser(req).id, id, false).then((data) => ok(data, 'Đã từ chối đăng nhập'));
  }
}
```

`auth.module.ts`: thêm `WebLoginController` vào `controllers`, `WebLoginService`
vào `providers`.

Tài liệu: thêm mục "Đăng nhập web bằng QR" vào `docs/app-auth-api.md` (5
endpoint, mã lỗi `QR_NOT_FOUND` 404 / `QR_EXPIRED` 410 / `QR_ALREADY_SCANNED` 409).

### A5. Kiểm và PR

```bash
cd api && npx tsc --noEmit -p tsconfig.json && npx vitest run
```

- Chạy cả chuỗi migration trên một DB trắng (như lần trước) và so schema với DB dev.
- Gọi thật bằng curl trên API đang chạy: tạo mã → poll `pending` → quét (token
  app) → poll `scanned` → duyệt → poll có token → poll lại `expired`.
- Commit, đẩy `feat/web-qr-login`, mở PR (kèm spec + kế hoạch đã commit).

---

## Phần B — Web (Mindo-Web, sửa tại chỗ, không commit)

Trước khi sửa: đọc `node_modules/next/dist/docs/` về route handler và cookies
(AGENTS.md cảnh báo Next bản này khác), và kiểm `proxy.ts` cho phép
`/api/auth/qr*` khi chưa đăng nhập.

### B1. Hai route BFF

- `src/app/api/auth/qr/route.ts` — `POST`: gọi `/investor/auth/qr` với body
  `{ device_info: <user-agent> }` và header `User-Agent` + `X-Forwarded-For` của
  trình duyệt. Tách `secret` khỏi phản hồi; đặt cookie `mindo_qr =
  "<session_id>.<secret>"` (`httpOnly`, `sameSite: lax`, `secure` ở production,
  `path: /api/auth/qr`, `maxAge: 180`). Trả trình duyệt `session_id`,
  `qr_value`, `expires_at`.
- `src/app/api/auth/qr/poll/route.ts` — `POST { session_id, remember }`: cookie
  thiếu hoặc khác `session_id` → `{ status: "expired" }`. Gọi
  `/investor/auth/qr/:id/poll { secret }`. API trả 404 → xoá cookie, trả
  `expired`. `approved` → `setSessionCookies(res, tokens, remember === true)`, xoá
  `mindo_qr`, trả `{ status: "approved", user }` — **không** trả token. `rejected` /
  `expired` → xoá cookie. Lỗi mạng (503) → chuyển nguyên để trình duyệt thử lại.

### B2. Dịch vụ thật

`src/services/qr-auth.service.ts` — thêm `createHttpQrAuthService(getRemember)`,
`createsRealSession: true`:
- `createSession`: `POST /api/auth/qr` → `{ sessionId, qrValue, expiresAt }`.
- `subscribe`: gọi ngay rồi mỗi **2 giây** `POST /api/auth/qr/poll` với
  `remember: getRemember()`. Chỉ phát khi trạng thái đổi. `approved | rejected |
  expired` → dừng. Lỗi mạng → bỏ qua, thử ở nhịp sau. Hết hạn phía trình duyệt chỉ
  áp khi còn `pending` (quét rồi thì server đã nới hạn). Trả hàm dừng.

Cập nhật chú thích đầu tệp: bản giả chỉ còn phục vụ `?qrDemo=`.

### B3. Ô "Ghi nhớ đăng nhập" + chọn dịch vụ

- `qr-login-panel.tsx`: thêm props `remember` / `onRememberChange`; dưới khối
  hướng dẫn (trạng thái `pending`) và dưới "Đang chờ xác nhận…" (`scanned`) vẽ
  đúng khối `<label><Checkbox/> Ghi nhớ đăng nhập</label>` như
  `password-login-form.tsx`. `createSession` lỗi (mất mạng) → chuyển sang
  `expired` để có nút "Tạo mã mới" thay vì treo.
- `login-view.tsx`: giữ `remember` bằng `useState`, đồng bộ vào một `ref` trong
  `useEffect`; `qrService = qrDemo ? createMockQrAuthService(qrDemo) :
  createHttpQrAuthService(() => rememberRef.current)`.

### B4. Kiểm

`npx tsc --noEmit` và `npm run lint` sạch trên các file vừa sửa. Mở
`/login?method=qr` bằng Chrome: mã hiện, đếm ngược chạy, DevTools thấy poll 2
giây/lần và **không** request nào trả token về trình duyệt; `?qrDemo=approved`
vẫn chạy bản giả.

---

## Phần C — App (nhánh `feat/web-qr-login`)

### C1. API client + đọc mã (TDD)

`src/services/webLoginApi.ts` — theo mẫu `callsApi.ts` (`apiClient`,
`unwrapData`, lớp lỗi mang `code` như `FriendError` trong `friendsApi.ts`):

```ts
export interface WebLoginDevice { browser: string | null; ipAddress: string | null; createdAt: string }
export class WebLoginError extends Error { constructor(readonly code: 'QR_EXPIRED' | 'QR_ALREADY_SCANNED' | 'QR_NOT_FOUND' | 'UNKNOWN', message: string) { super(message); } }
export function scanWebLogin(sessionId: string): Promise<WebLoginDevice>   // POST investor/auth/qr/:id/scan
export function approveWebLogin(sessionId: string): Promise<void>          // POST …/approve
export function rejectWebLogin(sessionId: string): Promise<void>           // POST …/reject
```

`src/screens/account/webLogin/parseWebLoginQr.ts`:

```ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Chỉ nhận đúng `mindo://web-login?session=<uuid>`; còn lại là QR khác. */
export function parseWebLoginQr(value?: string | null): string | null {
  const match = /^mindo:\/\/web-login\?session=([^&#\s]+)$/i.exec(value?.trim() ?? '');
  return match && UUID.test(match[1]) ? match[1].toLowerCase() : null;
}
```

Test `__tests__/parseWebLoginQr.test.ts`: mã đúng; link web thường; scheme khác;
id không phải UUID; chuỗi rỗng / `undefined`; tham số thừa phía sau.

### C2. Màn xác nhận (TDD)

`src/screens/account/WebLoginConfirmScreen.tsx`, params `{ sessionId, device }`:
- Dựng bằng `AccountFormLayout` (như `SessionsScreen`), tiêu đề *"Đăng nhập Mindo
  trên máy tính?"*; thẻ ba dòng trình duyệt · IP · thời điểm (`HH:mm`); đoạn cảnh
  báo; footer hai `AppButton`: **Đăng nhập** (primary) / **Từ chối** (secondary).
- Duyệt → `approveWebLogin` → toast *"Đã đăng nhập trên máy tính"* → `goBack`.
  Từ chối → `rejectWebLogin` → `goBack`.
- `beforeRemove`: rời màn khi **chưa** quyết định → gọi `rejectWebLogin` (bỏ qua lỗi)
  rồi cho đi. Đã quyết định thì đi thẳng.
- Lỗi `QR_EXPIRED` khi duyệt → toast *"Mã đã hết hạn, hãy tạo mã mới trên máy
  tính"* → `goBack`.

Test `__tests__/WebLoginConfirmScreen.test.tsx`: hiện đúng ba dòng; bấm Đăng nhập
gọi approve + goBack, không gọi reject; bấm Từ chối gọi reject; phát
`beforeRemove` khi chưa quyết định → gọi reject; hết hạn → toast.

### C3. Màn quét (TDD)

`src/screens/account/WebLoginScanScreen.tsx`:
- `useCameraPermission()`; chưa cấp → gọi `requestPermission()` một lần; bị từ chối →
  khối giải thích + nút **"Mở Cài đặt"** (`Linking.openSettings()`).
- `useCameraDevice('back')` + `<Camera isActive={focused} codeScanner={…} />`
  (`useIsFocused` để tắt camera khi rời màn), phủ tối chừa khung vuông 240, dòng
  hướng dẫn.
- `useCodeScanner({ codeTypes: ['qr'], onCodeScanned })`: khoá bằng `useRef` — đang
  xử lý thì bỏ qua mọi lần quét tiếp. Mã không hợp lệ → toast *"Đây không phải mã
  đăng nhập Mindo"*, mở khoá sau 2 giây. Hợp lệ → `scanWebLogin` → `replace` sang
  `WebLoginConfirmScreen`. `QR_EXPIRED` / `QR_ALREADY_SCANNED` → toast tương ứng,
  mở khoá.

Test `__tests__/WebLoginScanScreen.test.tsx` — `jest.mock('react-native-vision-camera')`
trong file: `useCameraPermission` trả `{hasPermission: true}`, `useCameraDevice`
trả `{}`, `useCodeScanner` giữ lại `onCodeScanned` để test gọi, `Camera` vẽ `View`.
Ca: QR lạ → toast, không gọi API; QR đúng bắn **hai lần** liền → `scanWebLogin`
chỉ gọi một lần → `replace` với đúng params; `QR_EXPIRED` → toast; không có quyền →
thấy nút "Mở Cài đặt".

### C4. Nối vào app

- `App.tsx`: `WebLoginScanScreen: undefined`, `WebLoginConfirmScreen: {sessionId:
  string; device: WebLoginDevice}` + hai `<Stack.Screen>`.
- `ProfileScreen.tsx`: dòng `qr` → `navigation.navigate('WebLoginScanScreen')`; gỡ
  `notReady` nếu không còn ai dùng.
- i18n (`BaseLanguage.ts`, `vi.ts`, `en.ts`): nhóm `account.web_login` cho mọi chuỗi
  ở C2–C3, và `api.web_login_failed`.
- `ios/ProjectName/Info.plist`: `NSCameraUsageDescription` → *"Mindo cần camera để
  bạn gọi video, chụp ảnh hồ sơ và quét mã đăng nhập web."*

### C5. Kiểm và PR

`npx tsc --noEmit`, `npx jest`, eslint trên file đã sửa. Simulator: vào Cá nhân →
dòng mở màn quét (simulator không có camera → màn báo không có camera / không quyền,
không sập). Commit, đẩy, mở PR ghi rõ **cần API PR lên trước**.

---

## Phần D — Đầu-cuối

1. API chạy bản của nhánh (`npm run dev:api`), web `npm run dev`.
2. Build app lên **iPhone 14 Pro Max** (team cá nhân, xem ghi chú build thiết bị).
3. Chrome trên Mac mở `/login?method=qr`, tick "Ghi nhớ đăng nhập".
4. Điện thoại: Cá nhân → Quét mã đăng nhập web → quét → màn xác nhận ghi "Chrome
   trên macOS" → Đăng nhập → web tự vào trang chính trong ≤ 2 giây.
5. Kiểm: cookie `mindo_rt` có `Max-Age` (vì đã tick); màn Phiên đăng nhập trên
   điện thoại có thêm dòng máy tính; lặp lại với **Từ chối** và với **để hết hạn**.
