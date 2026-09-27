# Đăng nhập web bằng mã QR — thiết kế

Chốt ngày **27/09/2026**. Trải ba repo: **Mindo-API** (endpoint), **Mindo-Web**
(nối UI đã có vào API thật), **Mindo-App** (quét và xác nhận).

## Mục tiêu

Trang `/login` của web có tab **Mã QR**. Người dùng mở app Mindo **đã đăng nhập**,
vào **Cá nhân → Quét mã đăng nhập web**, quét mã trên màn hình máy tính, xác nhận
trên điện thoại — và trình duyệt tự đăng nhập vào đúng tài khoản ấy.

Hiện trạng lúc chốt:

- Web đã dựng xong UI đủ 5 trạng thái (`pending | scanned | approved | rejected
  | expired`) trên một `QrAuthService` **giả** (`src/services/qr-auth.service.ts`).
- App đã có dòng "Quét mã đăng nhập web" ở Cá nhân (Figma 1866:2324) nhưng gắn vào
  hàm rỗng; đã có `react-native-vision-camera` 3.9.2 (cờ quét mã Android đã bật)
  và `react-native-permissions`.
- API chưa có endpoint QR nào.

## Quyết định

| Chủ đề | Chọn | Lý do |
| --- | --- | --- |
| Web biết trạng thái bằng gì | Hỏi mỗi **2 giây** qua BFF | Đi đúng đường BFF có sẵn, không thêm hạ tầng. Trễ ≤ 2 giây là vô hình vì sau khi quét người dùng còn phải bấm xác nhận. SSE phải xuyên route handler và proxy; socket chat đòi JWT mà web lúc này chưa đăng nhập. |
| Thời hạn phiên web | Thêm ô **"Ghi nhớ đăng nhập"** dưới mã QR | Người dùng tự chọn như tab Mật khẩu. `remember_me` phía server không đổi thời hạn — nó chỉ quyết định cookie của web sống bao lâu. |
| Lưu yêu cầu QR ở đâu | Bảng Postgres `WebLoginRequest` | Phiên đăng nhập đã nằm ở Postgres (`RefreshToken`); API không có Redis dùng chung. Chuyển trạng thái nguyên tử bằng `UPDATE … WHERE status = …`. |
| Phiên web cấp ra | Phiên **độc lập** qua `issueTokens` hiện có | Hiện trong danh sách phiên trên điện thoại, đăng xuất riêng được. Điện thoại đăng xuất thì web vẫn còn — y như đăng nhập web bằng mật khẩu. |

## Mô hình an toàn

Hai điều bắt buộc — thiếu một là tính năng thành lỗ hổng:

1. **QR chỉ chứa id công khai.** Web giữ thêm một **khoá bí mật** trong cookie
   httpOnly, không bao giờ nằm trong QR. Chỉ trình duyệt giữ khoá mới đổi được
   yêu cầu đã duyệt lấy token. Ai chụp lén QR cũng không cướp được phiên.
2. **Điện thoại hiện rõ đang đăng nhập cho máy nào** (trình duyệt + hệ điều hành,
   IP, thời điểm) kèm cảnh báo *"Chỉ xác nhận nếu chính bạn đang đăng nhập trên
   máy tính. Mindo không bao giờ yêu cầu bạn quét mã của người khác."* — chặn kiểu
   QRLjacking: kẻ gian gửi QR của máy mình cho nạn nhân quét.

Thông tin máy hiển thị do trình duyệt tự khai (user-agent) nên chỉ mang tính gợi
ý; lớp bảo vệ thật là (1) và câu cảnh báo.

## 1. API

### Bảng `WebLoginRequest`

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| `id` | `String @id` | UUID ngẫu nhiên, là thứ in trong QR |
| `secretHash` | `String` | SHA-256 của khoá bí mật; khoá gốc không lưu |
| `status` | enum `PENDING SCANNED APPROVED REJECTED CONSUMED` | |
| `userId` | `String?` | Người quét / xác nhận |
| `browser` | `String?` | Rút từ user-agent, vd "Chrome trên macOS" |
| `ipAddress` | `String?` | |
| `expiresAt` | `DateTime` | 60 giây sau khi tạo; nới thêm 60 giây khi quét |
| `createdAt`, `scannedAt`, `decidedAt` | `DateTime` | |

### Vòng đời

```
PENDING ──quét──▶ SCANNED ──xác nhận──▶ APPROVED ──web nhận token──▶ CONSUMED
                     └──────từ chối──▶ REJECTED
   quá expiresAt ở bất kỳ bước nào trước APPROVED → "expired"
```

Mọi bước chuyển là **một câu `UPDATE … WHERE id = ? AND status = <cũ> AND
expiresAt > now()`**. Không hàng nào bị đổi = đã có bên khác thắng hoặc đã hết
hạn. Hai lần poll hay hai máy quét cùng lúc thì chỉ một bên thắng — **không bao
giờ cấp hai phiên từ một mã**.

### Endpoint

Tất cả nằm dưới `/api/v1/investor/auth/qr`.

**Web (chưa đăng nhập, gọi qua BFF):**

`POST /investor/auth/qr` — body `{ device_info? }`

```json
{ "session_id": "…uuid…", "secret": "…", "qr_value": "mindo://web-login?session=…uuid…", "expires_at": "ISO" }
```

`POST /investor/auth/qr/:id/poll` — body `{ secret }`

```json
{ "status": "pending" | "scanned" | "rejected" | "expired" }
{ "status": "approved", "user": {…}, "access_token": "…", "refresh_token": "…", "session_id": "…" }
```

Khi yêu cầu đang `APPROVED`, lần poll này chuyển nó sang `CONSUMED` và trả token
**đúng một lần**; các lần sau trả `expired`. Khoá sai trả `404` như không tồn tại —
không để lộ rằng id có thật. POST chứ không GET để khoá không nằm trên URL hay log.

**App (đã đăng nhập, JWT):**

- `POST /investor/auth/qr/:id/scan` — `PENDING → SCANNED`, gán `userId`, nới
  `expiresAt` thêm 60 giây (người quét ở giây 55 vẫn kịp xác nhận). Trả
  `{ browser, ip_address, created_at }` cho màn xác nhận. Quét lại bởi **cùng**
  người thì trả lại y vậy; người **khác** đã quét trước thì `409 QR_ALREADY_SCANNED`.
  Hết hạn → `410 QR_EXPIRED`.
- `POST /investor/auth/qr/:id/approve` — `SCANNED → APPROVED`, chỉ đúng người đã quét.
- `POST /investor/auth/qr/:id/reject` — `SCANNED → REJECTED`, chỉ đúng người đã quét.

### Cấp phiên

Lúc poll đổi `APPROVED → CONSUMED`, server đọc lại người dùng; không còn `ACTIVE`
thì không cấp. Rồi gọi `issueTokens(user, { deviceInfo: browser, deviceType:
'desktop', userAgent, ipAddress })` — cùng đường với đăng nhập mật khẩu.

## 2. Web (Mindo-Web)

- **`createHttpQrAuthService`** thay bản giả, giữ nguyên interface `QrAuthService`
  nên `QrLoginPanel` và 5 trạng thái không phải sửa luồng. `subscribe` hỏi mỗi 2
  giây, dừng ở trạng thái kết thúc, và có mốc hết hạn phía trình duyệt phòng mất
  mạng. `createsRealSession = true`.
- Bản giả giữ lại **chỉ cho `?qrDemo=…`** để xem trước từng trạng thái Figma.
- **BFF `POST /api/auth/qr`** — gọi API tạo mã, chuyển tiếp user-agent và
  `x-forwarded-for` của trình duyệt. Cất `session_id` + khoá vào cookie httpOnly
  **`mindo_qr`** (3 phút). Trình duyệt chỉ nhận `session_id`, `qr_value`,
  `expires_at`.
- **BFF `POST /api/auth/qr/poll { remember }`** — đọc khoá từ cookie, hỏi API. Khi
  duyệt: đặt cookie đăng nhập bằng **đúng `setSessionCookies`** của tab Mật khẩu
  với `remember` gửi lên, xoá `mindo_qr`. Token không bao giờ xuống trình duyệt.
- **Ô "Ghi nhớ đăng nhập"** dưới mã QR, dùng lại `Checkbox` của tab Mật khẩu, hiện
  ở trạng thái *chờ quét* và *đã quét*. Đọc tại lúc nhận token nên đổi ý sau khi
  quét vẫn tính.
- Giới hạn chấp nhận: `mindo_qr` chỉ giữ mã mới nhất; mở hai tab QR thì tab cũ báo
  *hết hạn* và có nút "Tạo mã mới".

## 3. App (Mindo-App)

- Dòng **"Quét mã đăng nhập web"** ở Cá nhân mở `WebLoginScanScreen`.
- **`WebLoginScanScreen`** — camera toàn màn qua `useCodeScanner` (`qr`), phủ tối
  chừa khung vuông, dòng *"Hướng camera vào mã QR trên máy tính"*. Chưa có quyền
  camera → khối giải thích + nút **"Mở Cài đặt"**. Chỉ nhận
  `mindo://web-login?session=<uuid>`; QR khác → *"Đây không phải mã đăng nhập
  Mindo"* và quét tiếp. Mỗi mã chỉ kích hoạt một lần. Quét đúng → gọi `scan` →
  sang màn xác nhận; lỗi thì nói rõ (hết hạn / đã được quét bằng tài khoản khác).
- **`WebLoginConfirmScreen`** — *"Đăng nhập Mindo trên máy tính?"*, thẻ trình duyệt ·
  IP · thời điểm, câu cảnh báo, hai nút **Đăng nhập** / **Từ chối**. Duyệt → toast
  *"Đã đăng nhập trên máy tính"* → về Cá nhân. **Quay lại / vuốt thoát cũng tính là
  từ chối** để web báo ngay thay vì treo tới hết hạn.
- Sửa dòng xin quyền camera iOS thành *"…gọi video, chụp ảnh hồ sơ và quét mã
  đăng nhập web"* (thay đổi native — phải build lại).
- Chưa có frame Figma cho hai màn này: dựng theo token và component sẵn có của app.

## 4. Kiểm thử

- **API (vitest):** vòng đời trạng thái; khoá sai; token chỉ cấp một lần kể cả
  poll song song; hết hạn ở từng bước; tài khoản khác quét trước; tài khoản không
  còn `ACTIVE`; nới hạn khi quét. Chạy lại toàn bộ migration trên DB trắng.
- **App (jest):** đọc mã QR (đúng / sai dạng / id không phải UUID); màn xác nhận
  (duyệt, từ chối, quay lại = từ chối).
- **Web:** `tsc` + lint (repo chưa có bộ test), bấm tay trên trình duyệt.
- **Đầu-cuối:** simulator không có camera → quét thật trên **iPhone 14 Pro Max**
  (build team cá nhân); web mở bằng Chrome trên Mac. Các màn còn lại kiểm trên
  simulator.

## Ngoài phạm vi

- Mở mã từ **camera hệ thống** (deep link `mindo://web-login` ngoài app).
- Đẩy trạng thái tức thì (SSE / socket).
- Tên thành phố từ IP.
- Nhiều tab QR cùng lúc trên một trình duyệt.

## Lưu ý repo

**Mindo-Web chưa có remote và chưa có commit nào ngoài commit khởi tạo**, và đang
được một phiên khác sửa (phần peer). Phần web của tính năng này chỉ sửa vài file
riêng của luồng QR và **để nguyên chưa commit** — không có nơi nào để mở PR.
