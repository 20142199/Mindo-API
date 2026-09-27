# Mindo AI Chat API

Các endpoint dưới đây phục vụ màn AI Chat/AI Studio trong thiết kế Figma. Tất cả endpoint `investor` cần access token của người dùng.

## Cấu hình giao diện

- `GET /api/v1/ai/config`: danh sách chế độ, ngôn ngữ dịch, credit hiển thị, giới hạn file và `default_expert`.
- `GET /api/v1/ai/experts?q=finance`: tìm chuyên gia đang hoạt động theo tên hoặc chuyên môn.

## Hội thoại và lịch sử

- `POST /api/v1/investor/ai/conversations` với `{ "expert_id": "...", "title": "..." }`. Có thể bỏ `expert_id` để dùng trợ lý Mindo mặc định.
- `GET /api/v1/investor/ai/conversations?page=1&limit=20&q=robot&kind=IMAGE`. `q` tìm trong tên phiên và nội dung tin nhắn; `kind` nhận `CHAT`, `IMAGE`, `DOCUMENT`, `TRANSLATION`.
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

App theo dõi `GET /api/v1/investor/ai/conversations/:id/events` bằng SSE. Khi provider trả nội dung từng phần, trường `content` của tin `PENDING` tăng dần. Kết nối tự đóng khi không còn tin `PENDING`. Nếu hội thoại đang có một yêu cầu chờ xử lý, gửi thêm trả `409` với code `AI_MESSAGE_PENDING`.

`POST /api/v1/investor/ai/messages/:id/stop` dừng phản hồi đang xử lý. Tin nhắn chuyển sang `CANCELLED` và giữ lại phần nội dung đã nhận để màn hình hiển thị trạng thái **Đã dừng phản hồi**. Gọi lại endpoint cho một tin đã dừng là an toàn.

Queue tự thử tối đa ba lần. Chỉ khi lần cuối thất bại, tin AI mới chuyển sang `FAILED`. Lúc đó app gọi `POST /api/v1/investor/ai/messages/:id/retry` cho nút **Thử lại**.

Tin hoàn tất có metadata phục vụ giao diện: `model`, `input_tokens`, `output_tokens`, `total_tokens`, `duration_ms`, `credits`; ảnh có kích thước và `generated_attachment` với URL tải có chữ ký, tài liệu có tên/MIME, bản dịch có cặp ngôn ngữ và số ký tự.

## Quota và tài liệu

- `GET /api/v1/investor/ai/usage`: số lượt đã dùng, giới hạn và còn lại trong ngày. Kết quả còn có `base_limit`, `peer_owned`, `peer_bonus_per_item`, `peer_bonus_limit`, `reset_at` và `can_use`.
- `GET /api/v1/investor/ai/messages/:id/document`: tải tài liệu Word DOCX đã tạo.

Mặc định mỗi tài khoản có 50 lượt/ngày và mỗi Peer nội bộ đang sở hữu cộng thêm 10 lượt/ngày. Có thể đổi hai con số bằng biến môi trường, không cần sửa code.

## Biến môi trường

```ini
AI_MOCK=true
LLM_PRIMARY_VENDOR=gemini
LLM_FALLBACK_VENDOR=deepseek
GEMINI_API_KEY=
GEMINI_NATIVE_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_IMAGE_MODEL=gemini-3.1-flash-lite-image
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
AI_DAILY_MESSAGE_LIMIT=50
AI_DAILY_LIMIT_PER_PEER=10
AI_DEFAULT_EXPERT_SLUG=mindo-sang-tao
AI_CONTEXT_MESSAGES=20
AI_MAX_OUTPUT_TOKENS=2048
AI_TEMPERATURE=0.4
AI_TIMEOUT_MS=60000
```

`AI_MOCK=true` không gọi dịch vụ ngoài và phù hợp để app tích hợp UI. Khi bật provider thật, Gemini Native là provider chính và DeepSeek Chat là fallback, cùng cơ chế với Greenland. Hệ thống gửi tối đa `AI_CONTEXT_MESSAGES` tin hoàn tất gần nhất để giữ ngữ cảnh. Ảnh/PDF được gửi đa phương thức cho Gemini; hệ thống không âm thầm bỏ file để fallback sang DeepSeek. Sinh ảnh chỉ dùng Gemini Native và kết quả được lưu vào kho file riêng tư, không lưu Base64 trong bản ghi tin nhắn.
