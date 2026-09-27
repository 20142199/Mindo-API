# Màn Tạo ảnh — thiết kế

Ngày: 28/09/2026 · Phạm vi: Mindo-API + Mindo-App

Figma (file `oneBH6QD5NcZD7fxNeKEkn`):

| Node | Trạng thái |
|---|---|
| `1166:4089` | Form — mô tả, phong cách, tỷ lệ |
| `1166:3734` | Đang tạo |
| `1166:3770` | Kết quả |
| `1166:3817` | Xem lớn (toàn màn, nền tối) |
| `1166:3837` | Lỗi |

## Vì sao có màn riêng

Hiện tại "Tạo hình ảnh" mở một phiên chat thường, ảnh hiện thành bong bóng
trong dòng hội thoại. Thiết kế mới là một màn riêng có form (phong cách, tỷ
lệ) và bố cục khác hẳn chat. Nhồi vào `AiChatScreen` (~600 dòng) sẽ làm một
component gánh hai bố cục; tách ra thì mỗi màn gọn, và tầng API đã có (tạo
phiên, gửi tin, SSE, `/stop`, `/retry`) dùng lại nguyên.

## Các quyết định đã chốt

| Câu hỏi | Chốt | Lý do |
|---|---|---|
| Phong cách + tỷ lệ | Thêm vào backend | App tự ghép vào mô tả thì tỷ lệ chỉ là lời gợi ý, model có thể phớt lờ |
| Tải hình ảnh | Lưu vào thư viện Ảnh | Đúng nghĩa "tải ảnh" nhất |
| Màn lỗi | Thêm *Thử lại* + *Sửa mô tả* | Frame Figma không có nút nào; câu "mô tả vẫn được giữ lại" chỉ có nghĩa khi có chỗ dùng lại nó |
| Tiêu đề ảnh | AI đặt tên 2–5 chữ | Mô tả cắt ngắn không gọn như thiết kế |
| Phiên | Một phiên, nhiều ảnh | Giải thích bộ đếm `1 / 1` ở màn Xem lớn; Lịch sử không bị ngập phiên gần giống nhau |

## 1. Backend (Mindo-API)

### DTO

`CreateAiMessageDto` thêm hai trường tùy chọn, chỉ có nghĩa khi `kind = IMAGE`:

```
image_style?:  AUTO | NATURAL | THREE_D | ILLUSTRATION
aspect_ratio?: 1:1 | 4:3 | 9:16
```

Thiếu thì mặc định `AUTO` và `1:1` — phiên ảnh cũ và client cũ chạy như trước.

### Lưu vào metadata của tin

Hai giá trị được ghi vào `metadata` của tin trả lời. Nhờ vậy:
- `/retry` chạy lại đúng cài đặt cũ mà không cần client gửi lại.
- Mở lại phiên từ Lịch sử vẫn biết ảnh tạo theo tỷ lệ nào để vẽ đúng khung.

### Phong cách do server ghép vào prompt

`AUTO` không thêm gì. Ba giá trị còn lại thêm một câu chỉ dẫn vào cuối mô tả
trước khi gửi cho nhà cung cấp. Câu chữ nằm ở server để đổi được mà không
phải phát hành app.

### Tỷ lệ → nhà cung cấp

| Nhà | Cách truyền |
|---|---|
| Pollinations | `width` / `height` (1:1 → 1024×1024, 4:3 → 1024×768, 9:16 → 768×1344) |
| Gemini | `generationConfig.imageConfig.aspectRatio` |

### Tiêu đề ngắn

Khi ảnh **đầu tiên** của phiên xong, gọi model chữ (đường Gemini chat đang
chạy) tóm mô tả thành 2–5 chữ, đặt làm tiêu đề hội thoại.

**Lỗi đặt tên không bao giờ làm hỏng ảnh.** Gọi model chữ thất bại, trả rỗng
hay quá dài thì lùi về mô tả cắt ngắn như hiện tại. Ảnh đã tạo xong không
được đổi sang `FAILED` vì một bước phụ.

## 2. App (Mindo-App)

### `ImageGenScreen` — một màn, bốn trạng thái

| Trạng thái | Nội dung | Hành động |
|---|---|---|
| **Form** | ô mô tả · Phong cách 2×2 · Tỷ lệ 3 cột | *Tạo hình ảnh* — tắt khi mô tả rỗng; hết quota thì mở `UsageLimitDialog` như màn chat |
| **Đang tạo** | thẻ mô tả + thẻ chờ | *Hủy tạo ảnh* → `/stop` → **về lại form, giữ nguyên mô tả và cài đặt** |
| **Kết quả** | tiêu đề · ảnh đúng tỷ lệ · *Mô tả đã dùng* | *Tạo lại* (lượt mới, cùng cài đặt) · *Sửa mô tả* (về form đã điền sẵn) · *Tải hình ảnh* · bấm ảnh → Xem lớn |
| **Lỗi** | như Figma | **Thử lại** (`/retry`, không tốn lượt) · **Sửa mô tả** |

Route params: `{sessionId?: string}`. Không có `sessionId` → mở ở Form. Có →
nạp tin của phiên, hiện ảnh mới nhất ở trạng thái Kết quả (hoặc Lỗi / Đang tạo
nếu tin cuối đang ở trạng thái đó).

"Tạo lại" gửi tin mới chứ không dùng `/retry`: backend chỉ nhận `/retry` cho
tin `FAILED`, còn tin đã `COMPLETED` thì trả 409.

### `ImageViewerScreen`

Toàn màn, nền tối. Nút đóng, nút tải, tiêu đề, vuốt ngang qua **mọi ảnh của
phiên**, bộ đếm `i / n`. Params: `{sessionId, initialMessageId}`.

### Lưu vào thư viện Ảnh

- Thêm `@react-native-camera-roll/camera-roll`.
- Tải file về bộ nhớ tạm bằng `react-native-blob-util` (đã có), rồi lưu vào Ảnh.
- iOS: thêm `NSPhotoLibraryAddUsageDescription` vào Info.plist.
- Phải `pod install` và build lại native (xem memory: `yarn add` phải kèm `pod install`).

### Lối vào

Cả ba lối đều đổi sang màn mới:
- Thẻ *Tạo hình ảnh* ở `ChatHero`.
- Mục ảnh trong `NewSessionSheet`.
- Bấm phiên loại ảnh trong `ChatSessionsScreen` → mở `ImageGenScreen` với `sessionId`.

Icon Lịch sử ở header → `ChatSessionsScreen` hiện có.

## 3. Kiểm thử

**Backend**
- DTO từ chối `image_style` / `aspect_ratio` ngoài danh sách.
- Ánh xạ tỷ lệ đúng cho từng nhà (Pollinations width/height, Gemini aspectRatio).
- `/retry` dùng lại cài đặt trong metadata.
- Lỗi đặt tên không làm hỏng ảnh; lùi về mô tả cắt ngắn.

**App**
- Tham số gửi đi khớp lựa chọn trên form.
- Chuyển trạng thái: form → đang tạo → kết quả / lỗi.
- Hủy giữ lại mô tả và cài đặt.
- Mở phiên cũ nhảy đúng trạng thái theo tin cuối.
- Lưu ảnh xin quyền đúng, báo lỗi khi bị từ chối.

**Máy thật**: chạy trọn năm trạng thái trên simulator iPhone Air.

## 4. Ngoài phạm vi

- Driver OpenAI / Cloudflare — chờ key của PM. Tầng `IMAGE_VENDOR` đã sẵn.
- Phiên ảnh cũ tạo trong chat vẫn mở được ở màn mới; không có metadata thì
  hiện như "Theo mô tả", tỷ lệ 1:1.
