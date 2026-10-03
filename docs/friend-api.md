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

## Ảnh riêng gán cho một liên hệ

```http
PATCH /api/v1/investor/friends/{userId}/avatar
Content-Type: application/json

{ "avatar_file_id": "cmu..." }
```

Gửi `{"avatar_file_id": null}` để xoá, trở về ảnh hồ sơ của người đó.

Đây là ảnh **riêng của người gọi**, song song với `alias` (tên gợi nhớ) và cùng một lý do: `User.avatarFileId` là ảnh chủ tài khoản tự đặt, không ai đặt hộ được. Một chiều — A gán ảnh cho B thì B không biết, và hàng B→A vẫn trống.

Tệp phải do **chính người gọi** tải lên (qua `POST /api/v1/investor/chat/attachments`) và phải là ảnh; gán tệp của người khác hoặc id không tồn tại đều trả `400`. Không kiểm điều này thì đoán trúng một id là xem được ảnh riêng tư của người lạ.

`GET /friends` trả `alias_avatar_url` **riêng**, không đè lên `avatar_url`: màn sửa liên hệ cần biết cái nào là ảnh mình đặt mới mời "Xoá ảnh hiện tại" đúng lúc, và ảnh hồ sơ thật vẫn phải còn để rơi về. Cả hai đọc trong cùng một lượt truy vấn tệp.

## Realtime: `friend:updated`

Sau mỗi thao tác kết bạn **thành công**, server phát `friend:updated` trên namespace socket `/chat` (cách kết nối xem `docs/messaging-api.md`) vào phòng `user:{id}` của **cả hai** người. Phòng của người bấm cũng nhận, để các máy khác của chính họ cập nhật theo.

```json
{ "action": "request_accepted", "actor_user_id": "u-b", "target_user_id": "u-a", "at": "2026-10-03T07:00:00.000Z" }
```

| Thao tác | `action` | `actor_user_id` | `target_user_id` |
|---|---|---|---|
| `POST /api/v1/investor/friends/requests` | `request_sent` | người gửi | người nhận |
| `POST /api/v1/investor/friends/requests/{userId}/accept` | `request_accepted` | người chấp nhận | người đã gửi lời mời |
| `POST /api/v1/investor/friends/requests/{userId}/reject` | `request_rejected` | người từ chối | người đã gửi lời mời |
| `DELETE /api/v1/investor/friends/requests/{userId}` | `request_cancelled` | người huỷ | người từng được mời |
| `DELETE /api/v1/investor/friends/{userId}` | `friend_removed` | người xoá | người bị xoá |

- Chỉ phát **sau** khi giao dịch đã commit. Thao tác lỗi (`404`, `409`) không phát gì.
- Gói tin là **tín hiệu**, không phải dữ liệu: app nên gọi lại `GET /api/v1/investor/friends` và `GET /api/v1/investor/friends/requests` thay vì tự sửa danh sách. Cùng một gói đến cả hai phía; mỗi bên tự so `actor_user_id`/`target_user_id` với id của mình nếu cần biết ai bấm.
- Lỗi phát socket bị nuốt (chỉ ghi log), không bao giờ làm hỏng thao tác REST đã ghi xong. Socket rớt lúc app ở nền thì sự kiện mất: app nên tải lại danh sách khi quay lại foreground.
- **Không** phát cho tên gợi nhớ và ảnh riêng (`PATCH /api/v1/investor/friends/{userId}`, `PATCH /api/v1/investor/friends/{userId}/avatar`): đó là thay đổi một chiều, người kia không được biết.

## Cấu trúc dữ liệu

- `FriendRequest`: khóa chính `requesterId + recipientId`.
- `Friendship`: khóa chính `userId + friendUserId`; `alias` + `avatarFileId` là tên và ảnh riêng của chủ hàng, một chiều.
- `User.phoneNormalized`: khóa duy nhất phục vụ tìm kiếm, không phải khóa của quan hệ bạn bè.

Migration sẽ dừng nếu dữ liệu cũ có hai tài khoản trùng số điện thoại sau chuẩn hóa. Việc này tránh gửi lời mời nhầm tài khoản.

## Kiểm thử cục bộ

Khi PostgreSQL, Redis và API đang chạy:

```bash
npm run test:e2e:friends -w api
```

Bài kiểm tra bao gồm thêm bằng email, thêm bằng số `+84`, lời mời trùng/đảo chiều, phân quyền, chấp nhận, từ chối, hủy, xóa bạn và quan hệ hai chiều theo `user_id`.
