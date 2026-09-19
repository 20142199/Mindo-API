# Mindo friend API

Base URL: `/api/v1/investor/friends`. Tất cả endpoint yêu cầu `Authorization: Bearer <access_token>`.

Email và số điện thoại chỉ được dùng để tìm tài khoản khi gửi lời mời. Lời mời và quan hệ bạn bè chỉ lưu `user_id`; email hoặc số điện thoại thay đổi không ảnh hưởng quan hệ đã tạo.

## Gửi lời mời bằng email hoặc số điện thoại

```http
POST /api/v1/investor/friends/requests
Content-Type: application/json

{ "identifier": "friend@mindo.vn" }
```

Hoặc:

```json
{ "identifier": "+84 901 234 567" }
```

Số Việt Nam dạng `+84`, `0084` và `0...` được chuẩn hóa về cùng một giá trị. API không cho phép tự kết bạn, gửi trùng, gửi chiều ngược khi đang có lời mời đến hoặc gửi cho tài khoản không hoạt động.

Các mã lỗi nghiệp vụ HTTP `409`:

- `ALREADY_FRIENDS`: đã là bạn bè.
- `REQUEST_ALREADY_SENT`: lời mời đã được gửi.
- `INCOMING_REQUEST_EXISTS`: người kia đã gửi lời mời cho mình; dùng endpoint chấp nhận.

## Danh sách lời mời

```http
GET /api/v1/investor/friends/requests?page=1&limit=20
GET /api/v1/investor/friends/requests?direction=incoming
GET /api/v1/investor/friends/requests?direction=outgoing
```

Mỗi phần tử trả `direction`, hồ sơ `user` có khóa `user_id`, và `created_at`.

## Chấp nhận, từ chối hoặc hủy lời mời

`userId` trong URL luôn là khóa tài khoản, không phải email, số điện thoại hay ID lời mời.

```http
POST /api/v1/investor/friends/requests/:requesterUserId/accept
POST /api/v1/investor/friends/requests/:requesterUserId/reject
DELETE /api/v1/investor/friends/requests/:recipientUserId
```

- Chấp nhận/từ chối: người đang đăng nhập là người nhận; URL chứa `user_id` người gửi.
- Hủy: người đang đăng nhập là người gửi; URL chứa `user_id` người nhận.

Khi chấp nhận, database tạo hai bản ghi định hướng để truy vấn danh sách nhanh. Cả hai bản ghi có khóa chính ghép từ `user_id` và `friend_user_id`.

## Danh sách và tìm trong danh sách bạn bè

```http
GET /api/v1/investor/friends?page=1&limit=20
GET /api/v1/investor/friends?q=Nguyen
```

Kết quả có `user_id`, tên, biệt danh, avatar, email, số điện thoại và `friends_since`. Phía app dùng `user_id` làm `callee_user_id` khi bắt đầu audio/video call.

## Xóa bạn

```http
DELETE /api/v1/investor/friends/:friendUserId
```

API xóa quan hệ ở cả hai chiều trong cùng transaction.

## Cấu trúc dữ liệu

- `FriendRequest`: khóa chính `requesterId + recipientId`.
- `Friendship`: khóa chính `userId + friendUserId`.
- `User.phoneNormalized`: khóa duy nhất phục vụ tìm kiếm, không phải khóa của quan hệ bạn bè.

Migration sẽ dừng nếu dữ liệu cũ có hai tài khoản trùng số điện thoại sau chuẩn hóa. Việc này tránh gửi lời mời nhầm tài khoản.

## Kiểm thử cục bộ

Khi PostgreSQL, Redis và API đang chạy:

```bash
npm run test:e2e:friends -w api
```

Bài kiểm tra bao gồm thêm bằng email, thêm bằng số `+84`, lời mời trùng/đảo chiều, phân quyền, chấp nhận, từ chối, hủy, xóa bạn và quan hệ hai chiều theo `user_id`.
