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
- `message:send`: `{ channelId, messageType, content?, attachments?: [{fileId}], clientMessageId, parentMessageId? }`
- `message:edit`: `{ messageId, content }`
- `message:delete`: `{ messageId }`
- `typing:start`, `typing:stop`: `{ channelId }`

Server phát:

- `message:new`, `message:updated`, `message:deleted`, `message:read`
- `typing:peer`
- `conversation:updated`, `conversation:removed`, `conversation:deleted`

`clientMessageId` phải là UUID v4. Khi app retry cùng ID, server trả `status: duplicate` và không tạo bản ghi thứ hai.

## REST

Tất cả route dưới đây cần Bearer access token và có prefix `/api/v1/investor/chat`.

### Hội thoại

- `GET /conversations?page=1&limit=20&q=`: danh sách, tìm theo tên nhóm/người hoặc nội dung tin.
- `POST /conversations/direct` body `{ "user_id": "..." }`: tạo/lấy lại chat 1–1 với một người bạn.
- `POST /conversations/groups` body `{ "title": "...", "member_user_ids": ["..."], "avatar_file_id": "..." }`.
- `GET /conversations/:conversationId`: chi tiết và danh sách thành viên.
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

`message_type` nhận `TEXT`, `IMAGE`, `FILE`; `SYSTEM` chỉ server được tạo.

### Nhóm

- `PATCH /groups/:conversationId`: đổi `title` và/hoặc `avatar_file_id`.
- `POST /groups/:conversationId/members`: thêm `member_user_ids`.
- `DELETE /groups/:conversationId/members/:userId`: quản trị viên xóa thành viên.
- `DELETE /groups/:conversationId/leave`: rời nhóm; nếu chủ nhóm rời, quyền chủ nhóm được chuyển cho thành viên còn lại.
- `DELETE /groups/:conversationId`: chỉ chủ nhóm được xóa toàn bộ nhóm.

Chat cá nhân và thành viên nhóm chỉ nhận các tài khoản đã là bạn bè. Tệp đính kèm phải được upload bằng tài khoản gửi; URL tải file là URL ký có thời hạn và được làm mới khi đọc lịch sử.
