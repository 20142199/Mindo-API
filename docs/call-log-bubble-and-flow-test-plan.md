# Bong bóng nhật ký cuộc gọi + đợt test luồng người dùng

Ngày chốt: 27/09/2026. Bàn cùng chủ máy qua `/superpowers:brainstorming`.

## Vì sao đổi

Bong bóng nhật ký cuộc gọi hiện nằm **giữa luồng chat**, giống tin hệ thống
"đã thêm 3 thành viên". Nhưng cuộc gọi không phải thông báo của phòng — nó là
**việc giữa hai người, có người chủ động**. Đặt giữa thì mất hẳn thông tin đó,
và người dùng phải đọc chữ mới biết ai gọi ai.

Messenger giải quyết bằng vị trí: cuộc mình gọi nằm bên phải, cuộc người kia
gọi nằm bên trái — liếc qua là biết, không phải đọc.

## Bốn quyết định

**1. Pill nhạt, chỉ đổi lề.** Không dùng nền navy như bong bóng tin nhắn.
Nhật ký cuộc gọi phải đọc ra là "chuyện đã xảy ra", không phải "lời ai nói";
nền navy sẽ làm nó trông như một câu mình vừa gõ.

**2. Đỏ chỉ dành cho cuộc NHỠ của chính mình.** Mọi kết cục khác — không trả
lời, bị từ chối, đã huỷ — đều xám.

Vì sao hẹp như vậy: đỏ là để nói "có việc cần bạn làm". Chỉ cuộc gọi đến mà
mình lỡ mới đúng nghĩa đó. Tô đỏ cả "bị từ chối" thì đỏ xuất hiện thường
xuyên, và khi mọi thứ đều đỏ thì không còn gì là khẩn.

**3. Câu chữ rút gọn, bỏ chủ ngữ.** Vị trí đã nói ai gọi nên câu không lặp lại:

| Kết cục | Mình gọi (phải) | Người kia gọi (trái) |
|---|---|---|
| Hoàn thành | `Cuộc gọi thoại · 4:12` | `Cuộc gọi thoại · 4:12` |
| Không ai bắt máy | `Không trả lời` | `Cuộc gọi nhỡ` (đỏ) |
| Bị từ chối | `Đã từ chối` | `Đã từ chối` |
| Huỷ giữa chừng | `Đã huỷ` | `Đã huỷ` |

Đây cũng là cách gỡ bỏ lớp lật hai chiều trong `CallLogBubble` — chính lớp đó
đã im lặng sai suốt vì `callerUserId` không bao giờ khớp `ME_ID`
(xem PR Mindo-APP #21).

**4. Icon theo trạng thái, dùng lại icon có sẵn.** `ContactIcons` đã có
`IconCallIncoming`, `IconCallOutgoing`, `IconCallMissed` — không phải vẽ mới.
Gọi video vẫn dùng `IconVideoCall` kèm hướng suy từ lề.

## Ràng buộc kỹ thuật

- Chiều lấy từ `callLog.callerUserId === ME_ID`. Trường này **chỉ đúng sau**
  bản sửa ở `chatApi` (dùng `isMe`), nên test phải dùng id thật, không dùng
  `ME_ID` trong fixture — đó là lý do bộ test cũ xanh mà app sai.
- Nhóm không có cuộc gọi, nên không cần lo trường hợp nhiều người.
- Bấm vào bong bóng vẫn gọi lại đúng kiểu cũ (đã chạy được, giữ nguyên).

## Đợt test luồng người dùng

Chạy trên **hai iPhone thật** (14 Pro Max = `nguyenhongson.bk`, XR =
`sonnh.bk`), backend `api-mindo.stg-studio.com`. Bốn nhóm, chủ máy chốt chạy
cả bốn:

**A. Luồng gọi** — gọi thoại; gọi video có hình; từ chối; người gọi tự huỷ;
để chuông hết 60 giây; bấm bong bóng gọi lại đúng kiểu. Mỗi cuộc kiểm nhật ký
hiện **đúng lề, đúng màu, đúng icon** ở **cả hai máy**.

**B. Nhắn tin** — gửi chữ, ảnh, dán link xem preview, trả lời, sửa, thu hồi,
xoá có dialog xác nhận. Kiểm máy kia nhận realtime.

**C. Trạng thái & tìm kiếm** — chấm online, "x phút trước" sau khi máy kia
thoát app, tìm có dấu lẫn không dấu, ba tab Tất cả / Tin nhắn / Nhóm.

**D. Liên hệ & nhóm** — đổi tên gợi nhớ, ảnh đại diện bạn bè, số điện thoại
riêng; tạo nhóm, đổi tên và ảnh nhóm.

Nhớ hai giới hạn khi đọc kết quả: **không có push** nên máy nhận phải đang mở
app mới đổ chuông, và bản build hết hạn **02/10/2026**.
