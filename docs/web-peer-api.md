# Web Peer API

Base URL: `https://api-mindo.stg-studio.com/api/v1`

Các API có nhãn **Bearer** dùng access token của tài khoản investor đang dùng chung với app.

## Đăng nhập web bằng QR

1. `POST /investor/auth/qr-sessions` tạo QR. Kết quả có `session_id`, `qr_payload`, `expires_at` và `poll_after_seconds`.
2. App đã đăng nhập gọi `POST /investor/auth/qr-sessions/:id/scan` với body `{ "qr_token": "..." }`.
3. App gọi `POST /investor/auth/qr-sessions/:id/approve` hoặc `/reject` với cùng body.
4. Web gọi `GET /investor/auth/qr-sessions/:id/status`, gửi token ở header `X-QR-Token`. Khi được duyệt, kết quả trả `access_token`, `refresh_token` và `auth_session_id` đúng một lần.

QR mặc định sống 120 giây, cấu hình bằng `QR_LOGIN_TTL_SECONDS` (30–600 giây).

## Sản phẩm và cấu hình mua

- `GET /nfts`: danh sách sản phẩm.
- `GET /nfts/:id`: chi tiết sản phẩm, nguồn cung còn lại và loại sở hữu `MINDO_INTERNAL`.
- **Bearer** `GET /investor/invest/config?project_id=...`: giá 25 USD, tỷ giá, các mốc chiết khấu, số dư, KYC và danh hiệu hiện tại.

## Báo giá và mua Peer

### Tính giá

`POST /investor/invest/calculate-price` (**Bearer**)

```json
{
  "project_id": "NFT_ID",
  "amount": 50,
  "referral_code": "MDABCDEFGH"
}
```

Kết quả gồm giá niêm yết, tiền giảm, giá thực trả, cấp đạt được, `pricing_breakdown`, số dư còn thiếu và thông tin mã giới thiệu. Chiết khấu được tách theo từng đoạn khi đơn đi qua mốc 50 hoặc 200.

### Khóa báo giá

`POST /investor/invest/snapshot-price` (**Bearer**)

```json
{
  "nft_id": "NFT_ID",
  "amount": 50,
  "payment_type": "BALANCE",
  "referral_code": "MDABCDEFGH"
}
```

`price_snapshot` có hiệu lực 10 phút. Nếu trong lúc đó tài khoản đã mua đơn khác và thay đổi mốc danh hiệu, backend yêu cầu lấy báo giá mới.

### Xác nhận mua

`POST /investor/invest` (**Bearer**)

```json
{
  "price_snapshot": "SIGNED_TOKEN",
  "referral_code": "MDABCDEFGH"
}
```

Backend thực hiện nguyên tử: kiểm tra KYC/số dư/nguồn cung, trừ ví, cập nhật danh hiệu, cấp Peer nội bộ, trả thưởng trực tiếp 10% và thưởng đầu nhánh 5% nếu có. Snapshot đồng thời là khóa chống tạo trùng đơn.

- **Bearer** `GET /investor/invest/orders/:id`: trạng thái và chi tiết đơn.

## Kho Peer

- **Bearer** `GET /investor/me/nfts`: chế độ cũ, trả mảng để giữ tương thích app.
- **Bearer** `GET /investor/me/nfts?page=1&limit=20&q=PEER&project_id=...`: chế độ web có tìm kiếm và phân trang.
- **Bearer** `GET /investor/me/nfts/:id`: chi tiết Peer và chứng nhận sở hữu nội bộ.
- **Bearer** `GET /investor/history/nfts`: lịch sử mua, hỗ trợ `from`, `to`, `status`, `project_id`, `page`, `limit`.
- **Bearer** `GET /investor/history/nfts/:id`: chi tiết giao dịch.

### Giá USD

Quy theo tỷ giá **lúc mua** của từng đơn (`usd_vnd_rate` lưu trong đơn). Đơn tạo trước khi có cột này thì dùng tỷ giá hiện hành. Làm tròn 2 chữ số, trả dạng chuỗi.

- `history/nfts`: mỗi dòng có `amount_usd`, `gross_amount_usd`, `discount_usd`; `summary.total_spent_usd` là tổng các đơn hoàn tất.
- `history/nfts/:id`: `amount_usd`, `gross_amount_usd`, `discount_usd`.
- `me/nfts` (chế độ phân trang) và `me/nfts/:id`: `purchase` có thêm `quantity`, `effective_unit_price_vnd` (tổng đơn sau chiết khấu / số lượng), `effective_unit_price_usd`, `usd_vnd_rate`.

## Hoa hồng và doanh số đầu nhánh

- **Bearer** `GET /investor/referrals/commissions?from=2026-09-01&to=2026-09-30&type=DIRECT&page=1&limit=20`.
- **Bearer** `GET /investor/referrals/commissions/:id`.
- **Bearer** `GET /investor/referrals/branch-sales?from=2026-09-01&to=2026-09-30&page=1&limit=20`.

`branch-sales` trả HTTP 403 cho tài khoản không nhận mã ref tổng. Thưởng trực tiếp và thưởng đầu nhánh được trả theo cấu hình admin hiện hành.

## VietQR

`POST /investor/deposits` trả thêm:

```json
{
  "expires_at": "2026-09-27T16:15:00.000Z",
  "qr_expired": false,
  "display_status": "pending"
}
```

Thời hạn mặc định 15 phút, cấu hình bằng `VIETQR_QR_TTL_MINUTES` (5–60 phút). Lịch sử và chi tiết nạp cũng trả `expires_at` và `qr_expired`.

Gửi header `Idempotency-Key` để bấm lặp không tạo hai lệnh; thiếu thì server tự sinh.

### Huỷ lệnh nạp

**Bearer** `POST /investor/deposits/:id/cancel`

- Lệnh đang chờ → chuyển `CANCELLED`, `display_status: "cancelled"`. Gọi lại với lệnh đã huỷ trả nguyên trạng.
- Lệnh của người khác → 404. Lệnh đã thanh toán hoặc bị từ chối → 409.
- Lịch sử nạp hiện `status: "cancelled"` ("Đã huỷ"); bộ lọc `status=cancelled`.
- **Tiền về sau khi huỷ vẫn được cộng**: webhook VietQR nhận cả lệnh đã huỷ và chuyển thẳng sang đã thanh toán.
