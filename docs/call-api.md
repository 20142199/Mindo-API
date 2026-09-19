# Mindo audio/video call API

API cuộc gọi dùng Agora RTC cho âm thanh/hình ảnh và Agora RTM cho tín hiệu mời, nhận, từ chối và kết thúc. Dữ liệu cuộc gọi và lịch sử được lưu nội bộ trong PostgreSQL.

Base URL: `/api/v1/investor/calls`. Tất cả endpoint yêu cầu `Authorization: Bearer <access_token>`.

## Cấu hình

```env
AGORA_APP_ID=
AGORA_APP_CERTIFICATE=
AGORA_CUSTOMER_ID=
AGORA_CUSTOMER_SECRET=
AGORA_TOKEN_TTL_SECONDS=86400
CALL_RINGING_TIMEOUT_MS=60000
```

- `AGORA_APP_ID` và `AGORA_APP_CERTIFICATE` là bắt buộc để cấp RTC/RTM token.
- `AGORA_CUSTOMER_ID` và `AGORA_CUSTOMER_SECRET` bật gửi sự kiện RTM từ server. Nếu chưa cấu hình, app gửi `signaling.payload` nhận được từ API qua RTM.
- Không đưa App Certificate, Customer ID hoặc Customer Secret vào app.

## Luồng phía app

1. Sau khi đăng nhập, gọi `GET /rtm-token?client=app`, đăng nhập Agora RTM bằng `rtm_uid` và `rtm_token`, rồi lắng nghe peer message.
2. Khi nhấn nút gọi thoại hoặc video trong header hội thoại, gọi `POST /initiate`.
3. Người gọi vào kênh RTC bằng chính `app_id`, `channel_name`, `rtc_uid` và `rtc_token` trong `media`.
4. Người nhận xử lý sự kiện `call.invite`. Nếu app vừa mở lại hoặc bị mất sự kiện, gọi `GET /incoming` hay `GET /active` để khôi phục màn hình cuộc gọi.
5. Người nhận gọi `POST /:callId/accept`, sau đó vào kênh RTC bằng bộ `media` trả về; hoặc gọi `POST /:callId/reject`.
6. Một trong hai bên gọi `POST /:callId/end` khi gác máy. Nếu RTC token gần hết hạn, gọi `POST /:callId/token`.
7. Dùng `GET /history` để dựng danh sách cuộc gọi trong màn hình lịch sử/hội thoại.

Với web, dùng `client=web` hoặc `client_platform=web`. RTM UID của web có hậu tố `_web`, tránh việc phiên web và app của cùng tài khoản đá nhau khỏi RTM.

Mỗi sự kiện có `call_id`; app cần dùng giá trị này để loại sự kiện trùng. Khi `server_delivery_enabled=true`, backend đã gửi sự kiện đến cả app và web, app không gửi lại lần nữa.

## API

### Lấy RTM token

```http
GET /api/v1/investor/calls/rtm-token?client=app
```

`client`: `app` hoặc `web`.

### Bắt đầu cuộc gọi

```http
POST /api/v1/investor/calls/initiate
Content-Type: application/json

{
  "callee_user_id": "user-id",
  "call_type": "VIDEO",
  "conversation_id": "conversation-id",
  "client_platform": "app"
}
```

`call_type`: `AUDIO` hoặc `VIDEO`. `conversation_id` không bắt buộc và dùng để liên kết với hội thoại Mindo.

Phản hồi có ba phần:

- `call`: thông tin hiển thị, người đối diện và trạng thái.
- `media`: thông tin để join Agora RTC và đăng nhập RTM.
- `signaling`: sự kiện mời cùng trạng thái gửi từ server.

Nếu một trong hai người đang có cuộc gọi `RINGING` hoặc `ACCEPTED`, API trả HTTP `409` với mã `CALL_BUSY`.

### Nhận hoặc từ chối

```http
POST /api/v1/investor/calls/:callId/accept
Content-Type: application/json

{ "client_platform": "app" }
```

```http
POST /api/v1/investor/calls/:callId/reject
```

Chỉ người nhận mới có quyền dùng hai endpoint này. Phản hồi `accept` chứa bộ RTC token dành riêng cho người nhận.

### Kết thúc hoặc hủy cuộc gọi

```http
POST /api/v1/investor/calls/:callId/end
Content-Type: application/json

{}
```

Có thể gửi `reason` là `network_lost`, `peer_network_lost` hoặc `rtc_disconnect`. Endpoint này an toàn khi app gọi lặp lại do retry.

### Làm mới media token

```http
POST /api/v1/investor/calls/:callId/token
Content-Type: application/json

{ "client_platform": "app" }
```

Chỉ hai người tham gia cuộc gọi đang hoạt động mới lấy được token.

### Khôi phục trạng thái

```http
GET /api/v1/investor/calls/incoming
GET /api/v1/investor/calls/active
GET /api/v1/investor/calls/:callId
```

`incoming` trả cuộc gọi đến đang đổ chuông hoặc `null`. `active` trả cuộc gọi đang đổ chuông/đã nhận gần nhất hoặc `null`.

### Lịch sử

```http
GET /api/v1/investor/calls/history?page=1&limit=20&direction=incoming&call_type=VIDEO&status=COMPLETED
```

Các bộ lọc đều không bắt buộc:

- `direction`: `incoming`, `outgoing`.
- `call_type`: `AUDIO`, `VIDEO`.
- `status`: `RINGING`, `ACCEPTED`, `COMPLETED`, `REJECTED`, `CANCELLED`, `MISSED`, `FAILED`.

Mỗi bản ghi có `peer.full_name`, `peer.avatar_url`, `direction`, các mốc thời gian, `duration_sec` và `status_label` tiếng Việt để hiển thị trực tiếp.

## Sự kiện RTM

Payload có `v: 1`, `event`, `call_id`, `channel_name`, `conversation_id`, `call_type`, `status`, `caller_user_id` và `callee_user_id`.

Các sự kiện:

- `call.invite`: có cuộc gọi đến.
- `call.accept`: người nhận đã bắt máy.
- `call.reject`: người nhận từ chối.
- `call.cancel`: người gọi hủy trước khi bắt máy.
- `call.end`: cuộc gọi đã kết thúc.
- `call.missed`: hết thời gian đổ chuông.

## Lưu ý mobile

API hiện hỗ trợ cuộc gọi khi app đang hoạt động, tín hiệu RTM và khôi phục trạng thái khi app mở lại. Để điện thoại đổ chuông ổn định khi app đã bị hệ điều hành tắt hoàn toàn, phase mobile cần thêm FCM/APNs; iOS nên kết hợp PushKit/CallKit. Đây là lớp đánh thức ứng dụng, không thay đổi hợp đồng RTC và lịch sử ở trên.

## Kiểm thử cục bộ

Sau khi PostgreSQL, Redis và API đang chạy:

```bash
npm run test:e2e:calls -w api
```

Bài kiểm tra tạo ba tài khoản tạm, kiểm tra audio/video call, máy bận, phân quyền, tách RTM app/web, refresh token, kết thúc lặp và lịch sử; sau đó tự xóa dữ liệu thử.
