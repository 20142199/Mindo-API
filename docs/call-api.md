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

Chỉ NGƯỜI GỌI đang bận mới bị chặn: nếu chính người gọi đang có cuộc `RINGING` hoặc `ACCEPTED`, API trả HTTP `409` với mã `CALL_BUSY`. Gọi lại đúng người mình đang đổ chuông cũng trả `409` — cuộc cũ vẫn còn đó, tạo thêm chỉ sinh ra hai cuộc song song.

Người NHẬN đang bận thì KHÔNG chặn nữa. Cuộc mới vẫn được tạo và vẫn đổ chuông, để máy người nhận hiện thanh "cuộc gọi chờ" như Messenger; họ tự chọn bắt hay bỏ. Chặn ở server thì người thứ ba chỉ nhận về một lỗi khô khan, còn người đang nói thì không bao giờ biết là có ai vừa gọi.

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

Bắt một cuộc gọi chờ thì mọi cuộc còn sống KHÁC của người bắt bị gác hộ ngay trong cùng giao dịch: cuộc đang nói thành `COMPLETED` với `end_reason=switched_call`, cuộc còn đang đổ chuông thành `MISSED` với `end_reason=missed_while_busy`. Hai bên của cuộc bị gác đều nhận `call.end`. Không gác hộ thì người ta ở lại trong hai kênh RTC một lúc và nghe cả hai bên cùng lúc.

### Kết thúc hoặc hủy cuộc gọi

```http
POST /api/v1/investor/calls/:callId/end
Content-Type: application/json

{}
```

Có thể gửi `reason` là `network_lost`, `peer_network_lost` hoặc `rtc_disconnect`. Endpoint này an toàn khi app gọi lặp lại do retry.

### Chuyển cuộc thoại sang video

```http
POST /api/v1/investor/calls/:callId/upgrade
```

Bật hình cho một cuộc `AUDIO` đang nói. Cuộc gọi đổi `call_type` thành `VIDEO` tại chỗ — vẫn nguyên `call_id` và nguyên kênh RTC, nên không ai phải đổ chuông lại và lịch sử chỉ có MỘT dòng, ghi là cuộc gọi video.

Cả hai người tham gia đều gọi được, và gọi lặp lại thì không sao (cuộc đã là `VIDEO` thì trả về nguyên trạng). Cuộc chưa `ACCEPTED`, hoặc người gọi không thuộc cuộc đó, thì bị từ chối.

Người kia nhận sự kiện RTM `call.upgrade` và tự mở khung hình; ai chưa muốn bật camera của mình thì vẫn tắt được như thường.

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

`active` xếp cuộc ĐANG NÓI (`ACCEPTED`) lên trước cuộc đang đổ chuông, rồi mới tới cuộc mới hơn. Chỉ sắp theo thời gian thì lúc đang nói mà có người khác gọi tới, app mở lại sẽ nhảy vào cuộc gọi đến — bỏ rơi cuộc đang dở.

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
- `call.upgrade`: cuộc thoại vừa được bật hình; payload mang `call_type: "VIDEO"`.

## Lưu ý mobile

API gửi FCM priority cao với `data.type=incoming_call` khi bắt đầu cuộc gọi, song song với Agora RTM. Android dùng notification channel `mindo_calls`. Trên iOS, FCM hiển thị thông báo cuộc gọi; để có trải nghiệm VoIP native và đánh thức ổn định khi app bị hệ điều hành tắt hoàn toàn, app vẫn nên kết hợp APNs PushKit/CallKit. Đây là lớp đánh thức ứng dụng, không thay đổi hợp đồng RTC và lịch sử ở trên.

## Kiểm thử cục bộ

Sau khi PostgreSQL, Redis và API đang chạy:

```bash
npm run test:e2e:calls -w api
```

Bài kiểm tra tạo ba tài khoản tạm, kiểm tra audio/video call, máy bận, phân quyền, tách RTM app/web, refresh token, kết thúc lặp và lịch sử; sau đó tự xóa dữ liệu thử.
