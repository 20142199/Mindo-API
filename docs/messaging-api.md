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
- `conversation:updated`, `conversation:removed`, `conversation:deleted`

`clientMessageId` phải là UUID v4. Khi app retry cùng ID, server trả `status: duplicate` và không tạo bản ghi thứ hai.

Tin hệ thống (tạo nhóm, thêm/xóa thành viên) cũng được phát qua `message:new` như mọi tin khác, `sender` là `null`. Nó không sinh push notification.

**`message:new` và `message:updated` KHÔNG kèm `is_own`.** Trường đó trả lời câu "tin này có phải của bạn không", nên nó chỉ có nghĩa trên phản hồi REST — nơi có đúng một người hỏi. Một bản tin phát sóng thì không có "bạn" nào cả. Client tự so `message.sender.user_id` với user id của chính mình; đó cũng là cách duy nhất đúng, vì chỉ client mới biết nó đang đăng nhập bằng tài khoản nào.

**Mọi enum trên phản hồi trả đúng dạng đã khai, tức CHỮ HOA** — `message_type`, `type` của hội thoại, `role` của thành viên. Trùng với dạng mà request phải gửi lên, nên client đọc gì ghi lại được nấy.

## REST

Tất cả route dưới đây cần Bearer access token và có prefix `/api/v1/investor/chat`.

### Hội thoại

- `GET /conversations?page=1&limit=20&q=`: danh sách, tìm theo tên nhóm/người hoặc nội dung tin.
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

`POST /conversations/groups`, `POST /groups/:id/members` và `DELETE /groups/:id/members/:userId` trả thêm `system_message` — chính tin vừa được phát qua `message:new`.

### Nhóm

- `PATCH /groups/:conversationId`: đổi `title` và/hoặc `avatar_file_id`.
- `POST /groups/:conversationId/members`: thêm `member_user_ids`.
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
