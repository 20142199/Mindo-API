# Mindo AI Chat API

Các endpoint dưới đây phục vụ màn AI Chat/AI Studio trong thiết kế Figma. Tất cả endpoint `investor` cần access token của người dùng.

## Cấu hình giao diện

- `GET /api/v1/ai/config`: danh sách chế độ, ngôn ngữ dịch, credit hiển thị và giới hạn file.
- `GET /api/v1/ai/experts?q=finance`: tìm chuyên gia đang hoạt động theo tên hoặc chuyên môn.

## Hội thoại và lịch sử

- `POST /api/v1/investor/ai/conversations` với `{ "expert_id": "...", "title": "..." }`.
- `GET /api/v1/investor/ai/conversations?page=1&limit=20`.
- `GET /api/v1/investor/ai/conversations/:id`: chi tiết và 50 tin gần nhất.
- `GET /api/v1/investor/ai/conversations/:id/messages?page=1&limit=30`: tải lịch sử theo trang. Mỗi trang trả theo thứ tự cũ đến mới để app chèn thẳng vào danh sách.
- `PATCH /api/v1/investor/ai/conversations/:id` với `{ "title": "..." }`.
- `DELETE /api/v1/investor/ai/conversations/:id`.

## Gửi và theo dõi tin nhắn

`POST /api/v1/investor/ai/conversations/:id/messages`

```json
{
  "content": "Phân tích tài liệu này",
  "kind": "CHAT",
  "attachment_file_id": "optional-file-id",
  "source_language": "vi",
  "target_language": "en"
}
```

`kind` nhận `CHAT`, `IMAGE`, `DOCUMENT`, `TRANSLATION`. `source_language` và `target_language` dùng cho dịch thuật; API cũng chấp nhận nhãn ngôn ngữ do endpoint config trả về. Bản dịch tối đa 1.000 ký tự.

File được tải trước qua `POST /api/v1/investor/files/upload` (multipart field `file`). Chat hỗ trợ JPG, PNG, WebP và PDF riêng tư, tối đa 10 MB. API chỉ cho AI đọc file thuộc đúng người đang đăng nhập. Tin nhắn trả về có trường `attachment` gồm tên, MIME, dung lượng và URL có chữ ký ngắn hạn.

Kết quả tạo ngay hai bản ghi:

- `user_message`: tin người dùng, trạng thái `COMPLETED`;
- `assistant_message`: tin AI, trạng thái `PENDING`.

App theo dõi `GET /api/v1/investor/ai/conversations/:id/events` bằng SSE. Kết nối tự đóng khi không còn tin `PENDING`. Nếu hội thoại đang có một yêu cầu chờ xử lý, gửi thêm trả `409` với code `AI_MESSAGE_PENDING`.

Queue tự thử tối đa ba lần. Chỉ khi lần cuối thất bại, tin AI mới chuyển sang `FAILED`. Lúc đó app gọi `POST /api/v1/investor/ai/messages/:id/retry` cho nút **Thử lại**.

Tin hoàn tất có metadata phục vụ giao diện: `model`, `input_tokens`, `output_tokens`, `total_tokens`, `duration_ms`, `credits`; ảnh có kích thước, tài liệu có tên/MIME/dung lượng, bản dịch có cặp ngôn ngữ và số ký tự.

## Quota và tài liệu

- `GET /api/v1/investor/ai/usage`: số lượt đã dùng, giới hạn và còn lại trong ngày.
- `GET /api/v1/investor/ai/messages/:id/document`: tải tài liệu Markdown đã tạo.

## Biến môi trường

```ini
AI_MOCK=true
AI_API_BASE_URL=https://api.openai.com/v1
AI_API_KEY=
AI_CHAT_MODEL=gpt-4o-mini
AI_IMAGE_MODEL=gpt-image-1
AI_DAILY_MESSAGE_LIMIT=50
AI_CONTEXT_MESSAGES=20
AI_TIMEOUT_MS=60000
```

`AI_MOCK=true` không gọi dịch vụ ngoài và phù hợp để app tích hợp UI. Khi bật provider thật, hệ thống gửi tối đa `AI_CONTEXT_MESSAGES` tin hoàn tất gần nhất để AI giữ ngữ cảnh. Ảnh được gửi dưới dạng vision input và PDF được gửi bằng file content part của Chat Completions.
