# Mindo Messaging API

Nhắn tin Mindo dùng REST để tải danh sách/lịch sử và Socket.IO để đồng bộ realtime. Khóa người dùng ở mọi nơi là `user_id`.

## Socket.IO

- URL production: `https://api-mindo.stg-studio.com/chat`
- Namespace: `/chat`
- Auth: `auth: { token: '<access_token>' }` (chấp nhận cả chuỗi `Bearer <token>`)
- Transport: WebSocket, tự fallback HTTP polling
- Mỗi thiết bị tự vào room `user:{user_id}`. Sau `channel:join`, thiết bị vào room `channel:{conversation_id}`.

Client gửi:

- `channel:join`, `channel:leave`: `{ channelId }`
- `message:send`: `{ channelId, messageType, content?, attachments?: [{fileId}], clientMessageId, replyToMessageId? }`
- `message:edit`: `{ messageId, content }`
- `message:delete`: `{ messageId }`
- `typing:start`, `typing:stop`: `{ channelId }`

Server phát:

- `message:new`, `message:updated`, `message:deleted`, `message:read`
- `typing:peer`
- `presence:updated`: `{ user_id, is_online, last_seen_at }`
- `conversation:updated`, `conversation:removed`, `conversation:deleted`
- `friend:updated`: quan hệ bạn bè vừa đổi (gửi / chấp nhận / từ chối / huỷ lời mời, xoá bạn) — xem `docs/friend-api.md#realtime-friendupdated`

`presence:updated` bắn vào `user:{id}` của MỌI người có chung ít nhất một hội thoại chưa xoá với người vừa đổi trạng thái. Chỉ bắn ở socket ĐẦU TIÊN khi vào mạng và socket CUỐI CÙNG khi rời — mở thêm thiết bị thứ hai không sinh sự kiện, và đóng một trong hai thiết bị cũng vậy. `last_seen_at` chỉ có giá trị ở gói `is_online: false`; nó được ghi vào `User.lastSeenAt` cùng lúc.

Nhóm KHÔNG có trạng thái hoạt động: `is_online` luôn `false` và `last_seen_at` luôn `null` trên dòng `GROUP`.

Tập socket đang mở nằm ở Redis (`mindo:chat:online:{userId}`), mỗi thành viên ghi dạng `{nodeId}|{socketId}`. Mỗi tiến trình server giữ một khoá nhịp tim `mindo:chat:node:{nodeId}` TTL 60s; lúc khởi động nó quét bỏ socket của những tiến trình không còn khoá đó. Không có bước quét này thì một lần server chết là đủ làm hỏng hẳn presence của những người đang kết nối lúc đó — tập của họ không bao giờ còn về 0 nên không ai được báo là họ đã offline. Hệ quả kèm theo: **mỗi lần triển khai, presence của mọi người reset**, và chấm sáng lại khi máy họ nối lại.

`clientMessageId` phải là UUID v4. Khi app retry cùng ID, server trả `status: duplicate` và không tạo bản ghi thứ hai.

Tin hệ thống (tạo nhóm, thêm/xóa thành viên) cũng được phát qua `message:new` như mọi tin khác, `sender` là `null`, kèm `system_info` (xem phần REST). Nó không sinh push notification.

**`message:new` và `message:updated` KHÔNG kèm `is_own`.** Trường đó trả lời câu "tin này có phải của bạn không", nên nó chỉ có nghĩa trên phản hồi REST — nơi có đúng một người hỏi. Một bản tin phát sóng thì không có "bạn" nào cả. Client tự so `message.sender.user_id` với user id của chính mình; đó cũng là cách duy nhất đúng, vì chỉ client mới biết nó đang đăng nhập bằng tài khoản nào.

**Mọi enum trên phản hồi trả đúng dạng đã khai, tức CHỮ HOA** — `message_type`, `type` của hội thoại, `role` của thành viên. Trùng với dạng mà request phải gửi lên, nên client đọc gì ghi lại được nấy.

## REST

Tất cả route dưới đây cần Bearer access token và có prefix `/api/v1/investor/chat`.

### Nhật ký cuộc gọi trong hội thoại

Mỗi cuộc gọi kết thúc (`COMPLETED`, `MISSED`, `REJECTED`, `CANCELLED`) sinh MỘT tin `SYSTEM` trong hội thoại 1-1 giữa hai người, và `conversation:updated` được phát ngay cho cả hai.

Tin mang `call_info`: `{ call_id, call_type, status, duration_sec, caller_user_id }`. `content` đã có sẵn câu chữ nên bản app cũ đọc được ngay; bản mới dùng `call_info` để vẽ icon, tô đỏ cuộc nhỡ và cho gọi lại.

CHIỀU GỌI do app tự suy từ `caller_user_id`, không ghi sẵn vào `content`: một tin hệ thống hiện giống nhau cho cả hai phía, nên "Bạn đã gọi" thì đúng với một người và sai với người kia. Cùng lý do đó, "không bắt máy" hiện là *Không trả lời* ở phía người gọi và *Cuộc gọi nhỡ* ở phía người nhận.

Hai người chưa từng nhắn thì hội thoại được TẠO. Gọi cho ai đó rồi mở Tin nhắn không thấy gì là mất dấu cuộc gọi.

Ghi nhật ký chạy ngoài luồng và không bao giờ ném: hỏng thì mất một dòng trong chat, còn ném thì người dùng không cúp máy được — nó chạy sau khi trạng thái đã vào CSDL.

### Thẻ xem trước link

```http
GET /api/v1/investor/chat/link-preview?url=https://mindo.vn/tin/abc
```

Trả `{ url, title, description, image, site_name }`, hoặc `data: null` khi không đọc được. **Luôn 200** — link chết hay trang chặn bot là chuyện thường ngày, không phải lỗi của người dùng.

App gọi lúc SOẠN rồi gửi lại nguyên văn qua `link_preview` của `message:send`; server lưu vào `ChatMessage.linkPreview` và trả lại trong mọi payload tin nhắn. Nhờ vậy mỗi link chỉ tải một lần, ai xem cũng thấy giống nhau, và **IP người nhận không bị lộ cho trang đích**. Tin bị thu hồi thì `link_preview` về `null` cùng với nội dung.

Đây là chỗ DUY NHẤT server tải một URL do người dùng cung cấp, nên nó chặn SSRF nhiều lớp: chỉ `http`/`https`; cấm dải nội bộ (RFC1918, loopback, link-local `169.254.169.254`, CGNAT, IPv6 riêng, IPv4 khoác áo IPv6); **tra DNS rồi mới quyết** để chặn tên miền công khai trỏ ngược vào loopback; tự đi theo chuyển hướng và kiểm lại từng chặng (tối đa 3); chỉ đọc `text/html`, cắt ở 512 KB, chờ tối đa 6 giây. `og:image` trỏ vào mạng nội bộ cũng bị bỏ — nếu không, máy NGƯỜI DÙNG thành công cụ dò cổng trong mạng của chính họ.

### Hội thoại

- `GET /conversations?page=1&limit=20&q=&type=`: danh sách hội thoại.
  `q` tìm theo TÊN — tên nhóm hoặc tên thành viên. Không tìm nội dung tin nhắn: kết quả là
  hội thoại chứ không phải tin, nên một hội thoại khớp vì nội dung sẽ hiện ra mà không có
  đoạn trích nào giải thích vì sao. Tìm trong nội dung một hội thoại thì dùng
  `GET /conversations/:id/messages?q=`.
  `q` KHÔNG phân biệt dấu và hoa thường: `dau tu`, `Đầu tư`, `ĐẦU TƯ` cho cùng kết quả.
  Cách làm: mỗi cột tên có một cột song song đã bỏ dấu (`titleNormalized`,
  `fullNameNormalized`, `nicknameNormalized`, `aliasNormalized`) do trigger giữ đồng bộ ở
  mọi đường ghi, kèm index GIN trigram; từ khoá đi qua `searchKey()` cho ra đúng cùng một
  dạng. Xem migration `202609270002_search_normalized` — nó giải thích vì sao KHÔNG dùng
  `unaccent`. `GET /friends?q=` dùng chung cơ chế này.
  `type` nhận `DIRECT` hoặc `GROUP`, phục vụ ba tab tìm kiếm của app; vắng mặt là lấy cả hai.
  Mỗi dòng kèm `peer_user_id` — id người kia với hội thoại `DIRECT`, `null` với `GROUP` —
  và `last_seen_at` (ISO hoặc `null`), mốc lần cuối người kia đóng socket chat.
  Danh sách KHÔNG kèm `members` (chỉ `GET /conversations/:id` có), nên đây là cách duy nhất
  để client biết dòng hội thoại 1-1 thuộc về ai: tra danh bạ, khớp sự kiện presence, dựng
  chữ cái đầu khi người kia chưa đặt ảnh.
- `POST /conversations/direct` body `{ "user_id": "..." }`: tạo/lấy lại chat 1–1 với một người bạn.
- `POST /conversations/groups` body `{ "title": "...", "member_user_ids": ["..."], "avatar_file_id": "..." }`.
- `GET /conversations/:conversationId`: chi tiết và danh sách thành viên. Mỗi thành viên kèm `last_read_message_id` và `last_read_at` — dùng để dựng lại dấu "đã xem" cho tin cũ sau khi app mở lại, vì sự kiện `message:read` chỉ phục vụ phiên đang mở.
- `DELETE /conversations/:conversationId`: ẩn hội thoại khỏi danh sách của chính người gọi.
- `POST /conversations/:conversationId/read` body tùy chọn `{ "message_id": "..." }`.
- `PATCH /conversations/:conversationId/mute` body `{ "is_muted": true }`.

### Tin nhắn

- `GET /conversations/:conversationId/messages?cursor=&limit=50&q=`: phân trang lùi; response trả theo thứ tự thời gian tăng dần.
- `POST /conversations/:conversationId/messages`: REST fallback khi socket chưa kết nối.
- `PATCH /messages/:messageId`: sửa nội dung trong 72 giờ.
- `DELETE /messages/:messageId`: thu hồi hai phía.
- `POST /messages/:messageId/save`, `DELETE /messages/:messageId/save`.
- `GET /saved-messages?page=1&limit=20&q=`.
- `POST /attachments` multipart field `files`, tối đa 5 tệp, mỗi tệp 10 MB.

Body gửi tin qua REST:

```json
{
  "message_type": "TEXT",
  "content": "Xin chào",
  "attachments": [{ "file_id": "..." }],
  "client_message_id": "21efbc58-c8be-4bc4-a942-1bd10e9d5f4c",
  "reply_to_message_id": null
}
```

`message_type` nhận `TEXT`, `IMAGE`, `FILE`; `SYSTEM` chỉ server được tạo. Phản hồi trả lại đúng dạng chữ hoa này.

Gửi kèm `reply_to_message_id` thì mọi phản hồi sau đó mang thêm `quoted_message`. Lúc gửi server chụp lại tin gốc, nhưng mỗi lần TRẢ RA (danh sách tin, tin đã lưu, phản hồi gửi/sửa, `message:new`, `message:updated`) nó đọc lại tin gốc và thay nội dung bằng bản SỐNG:

```json
{
  "reply_to_message_id": "cmuh5ubya0003p6ubofqcxmi2",
  "quoted_message": {
    "kind": "REPLY",
    "source_message_id": "cmuh5ubya0003p6ubofqcxmi2",
    "source_sender_name": "Nguyen Hong Son Nickname",
    "source_message_type": "TEXT",
    "content_preview": "Chào B, tin thật đầu tiên",
    "attachment_file_id": "…",
    "source_sender_id": "cmuh5u9xk0000p6ub2q7hd3l1",
    "recalled": false
  }
}
```

- Tin gốc đã sửa: `content_preview` là chữ MỚI, cắt y như lúc chụp.
- Tin gốc đã thu hồi, hoặc không còn trong CSDL: `content_preview` là `"Tin nhắn đã được thu hồi"`, `attachment_file_id` bị bỏ, `recalled: true`. Tên người viết vẫn giữ.
- `source_sender_id`: id người viết tin gốc, để app hiện "Bạn" hay tên gợi nhớ thay cho `source_sender_name` (tên chụp lúc gửi). Có thể `null` với tin trả lời cũ khi tin gốc không còn người viết.
- Chính tin trả lời đã bị thu hồi (`deleted_at` khác null): `quoted_message` là `null`, như `content`, `attachments` và `link_preview`.
- `GET /saved-messages`: tin đã lưu thuộc hội thoại mình đã rời hoặc bị xoá khỏi thì ô trích dẫn giữ chữ CHỤP lúc gửi (không đọc bản sống, để không thấy tin gốc người ta sửa về sau); tin gốc đã thu hồi thì vẫn che và `recalled: true`.
- Sự kiện `message:updated` / `message:deleted` của tin GỐC không kéo theo sự kiện nào cho các tin trả lời nó; app đang mở hội thoại tự vá ô trích dẫn trong bộ nhớ, còn lần tải sau thì server đã trả bản sống.

Tên trường bên trong có tiền tố `source_`, KHÔNG phải `message_id`/`sender_name`/`preview`. `attachment_file_id` chỉ xuất hiện khi tin gốc có tệp đính kèm, `content_preview` cắt ở 200 ký tự. Đoán tên khác đi thì client không văng lỗi — nó dựng ra một khối trích dẫn rỗng, đúng một vạch màu không chữ, và chỉ lộ ra khi tải lại màn.

`POST /conversations/groups`, `PATCH /groups/:id`, `POST /groups/:id/members` và `DELETE /groups/:id/members/:userId` trả thêm `system_message` — chính tin vừa được phát qua `message:new`. Ở `PATCH /groups/:id` trường này là `null` khi lần lưu đó không đổi gì thật.

Mọi tin (và `last_message` của hội thoại) có trường `system_info`. Tin hệ thống của NHÓM mang:

```json
{
  "event": "MEMBERS_ADDED",
  "actor_user_id": "…",
  "actor_name": "Nguyen Hong Son",
  "target_user_ids": ["…", "…"],
  "target_names": ["Anna", "Trần Bình"]
}
```

| `event` | Khi nào | Trường thêm |
|---|---|---|
| `GROUP_CREATED` | tạo nhóm | — |
| `GROUP_UPDATED` | đổi tên và/hoặc ảnh nhóm | `new_title` (null nếu tên không đổi), `avatar`: `CHANGED` / `REMOVED` / null |
| `MEMBERS_ADDED` | thêm thành viên | `target_user_ids`, `target_names` (cùng thứ tự) — chỉ những người THẬT SỰ vừa vào (kể cả người từng rời được thêm lại), không gồm người đang ở sẵn trong nhóm; số trong `content` cũng đếm như vậy |
| `MEMBER_REMOVED` | quản trị viên xoá một người | `target_user_ids`, `target_names` (một phần tử) |
| `MEMBER_LEFT` | tự rời nhóm | — |

`content` vẫn là câu dựng sẵn y như trước để app cũ đọc được, nhưng nó viết theo góc nhìn của không ai cả. App mới dựng câu từ `system_info`: `actor_user_id` là mình thì "Bạn", là bạn bè thì tên gợi nhớ, còn lại thì `actor_name`. `actor_name`/`target_names` là tên CHỤP lúc xảy ra, dùng khi người đó đã rời nhóm và không còn tra được. `sender` của tin hệ thống vẫn `null`. Tin cũ (trước migration `20261003000000_chat_message_system_info`), tin thường và nhật ký cuộc gọi có `system_info: null`; gặp `null` hoặc `event` lạ thì hiện `content`.

### Nhóm

- `PATCH /groups/:conversationId`: đổi `title` và/hoặc `avatar_file_id`; chỉ chủ nhóm và quản trị viên gọi được.
  - `avatar_file_id: null` là XOÁ ảnh nhóm. Không gửi khoá đó mới là để ảnh nguyên như cũ — hai thứ này khác nhau, đừng gửi chuỗi rỗng.
  - Mỗi lần đổi sinh một tin hệ thống trong khung chat ("... đã đổi tên nhóm thành ..."). Đổi cả tên và ảnh trong cùng một lời gọi thì GỘP một tin, nên app hãy gửi một `PATCH` duy nhất thay vì hai.
  - Đặt lại đúng giá trị đang có thì không sinh tin nào và `system_message` là `null`.
- `POST /groups/:conversationId/members`: thêm `member_user_ids`. Mọi người trong danh sách đều đang ở sẵn trong nhóm thì trả `400` ("Những người này đã ở trong nhóm") và không ghi tin hệ thống.
- `DELETE /groups/:conversationId/members/:userId`: quản trị viên xóa thành viên.
- `DELETE /groups/:conversationId/leave`: rời nhóm; nếu chủ nhóm rời, quyền chủ nhóm được chuyển cho thành viên còn lại.
- `DELETE /groups/:conversationId`: chỉ chủ nhóm được xóa toàn bộ nhóm.

Chat cá nhân và thành viên nhóm chỉ nhận các tài khoản đã là bạn bè. Tệp đính kèm phải được upload bằng tài khoản gửi; URL tải file là URL ký có thời hạn và được làm mới khi đọc lịch sử.

## Firebase push notification

Socket.IO xử lý realtime khi app đang mở. Firebase Cloud Messaging đánh thức/thông báo cho thiết bị khi app chạy nền hoặc đã đóng.

- Khi đăng nhập, app nên gửi `fcm_token` cùng body login.
- Mỗi khi Firebase làm mới token, gọi `PUT /api/v1/investor/devices/push-token` với body `{ "fcm_token": "..." }`.
- Khi người dùng tắt thông báo hoặc đăng xuất thiết bị, gọi `DELETE /api/v1/investor/devices/push-token` trước khi xóa token tại app.
- Một tài khoản có thể đăng nhập và nhận thông báo trên nhiều thiết bị.
- Hội thoại đã mute và tài khoản tắt `in_app_notifications` sẽ không nhận push tin nhắn.
- Token Firebase hết hạn/không còn đăng ký được API tự loại bỏ.

Payload tin nhắn có `data.type=chat_message`, `conversation_id`, `message_id`, `sender_user_id`, `message_type`. Payload cuộc gọi đến có `data.type=incoming_call`, `call_id`, `caller_user_id`, `caller_name`, `call_type`, `conversation_id`.

Android cần tạo notification channel `mindo_messages` và `mindo_calls`. iOS cần bật Push Notifications và Background Modes > Remote notifications; cuộc gọi VoIP native khi app bị hệ điều hành tắt hoàn toàn vẫn nên bổ sung APNs PushKit/CallKit ở phía iOS.
