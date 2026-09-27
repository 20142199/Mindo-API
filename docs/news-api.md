# Mindo News API

Tính năng tin tức bám theo flow Figma gồm Tường, Khám phá, Tìm kiếm, Bài viết, Hồ sơ chuyên gia, Cá nhân và Sóng.

## API cho ứng dụng

Các API đọc chấp nhận access token nhưng không bắt buộc; khi có token, response có thêm trạng thái `is_following`, `is_liked` và tự loại nội dung người dùng không quan tâm.

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | `/api/v1/news/home` | Tường: chuyên gia đề xuất, bài viết, Sóng |
| GET | `/api/v1/news/articles` | Danh sách; hỗ trợ `feed`, `q`, `topic`, `expert`, `type`, `page`, `limit` |
| GET | `/api/v1/news/articles/:idOrSlug` | Chi tiết bài viết/Sóng |
| GET | `/api/v1/news/search?q=...` | Tìm đồng thời bài viết và chuyên gia |
| GET | `/api/v1/news/topics` | Danh sách lĩnh vực |
| GET | `/api/v1/news/experts` | Khám phá chuyên gia |
| GET | `/api/v1/news/experts/:idOrSlug` | Hồ sơ và bài đăng của chuyên gia |
| POST/DELETE | `/api/v1/news/experts/:id/follow` | Theo dõi/bỏ theo dõi |
| GET | `/api/v1/news/me` | Hồ sơ tin tức cá nhân, kèm `hidden_topic_ids` |
| GET | `/api/v1/news/me/ai-summary-usage` | Hạn mức mở tóm tắt AI tháng này (cần đăng nhập) |
| PATCH | `/api/v1/news/me/interests` | Chọn lĩnh vực quan tâm với `{ "topic_ids": [] }` |
| POST/DELETE | `/api/v1/news/articles/:id/like` | Thích/bỏ thích |
| POST | `/api/v1/news/articles/:id/ai-summary` | Mở bản tóm tắt AI của bài, trừ 1 lượt (cần đăng nhập) |
| POST | `/api/v1/news/articles/:id/feedback` | `NOT_INTERESTED`, `HIDE_TOPIC`, `HIDE_SOURCE`, `REPORT` |

### Bảng tin

- `feed=for_you` chỉ trả bài thuộc các lĩnh vực người dùng quan tâm; cần access token (không có thì `401`). Chưa chọn lĩnh vực nào thì danh sách rỗng — app dựa vào `interests` của `GET /news/me` để hiện trạng thái "chưa chọn lĩnh vực", không dựa vào việc danh sách rỗng. Bỏ trống hoặc `feed=all` là toàn bộ bài.
- Mỗi bài có `source: { id, name } | null` — tên nguồn cho dòng "CafeF · 2 giờ".
- Bài người dùng đã ẩn bị loại ở `home` và `articles`: `NOT_INTERESTED` ẩn đúng bài đó, `HIDE_TOPIC` ẩn cả lĩnh vực, `HIDE_SOURCE` ẩn cả nguồn. Bài chưa có lĩnh vực hoặc chưa có nguồn thì không bị ẩn theo.
- `HIDE_TOPIC` cần bài có lĩnh vực, `HIDE_SOURCE` cần bài có nguồn; thiếu thì `400`. `HIDE_TOPIC` đồng thời bỏ lĩnh vực đó khỏi danh sách quan tâm; chọn lại lĩnh vực đó qua `PATCH /me/interests` thì hết ẩn.

### Tóm tắt AI và hạn mức

- `ai_summary` (4–5 dòng, ngăn bằng `\n`) **không** có trong danh sách, tìm kiếm, trang chủ hay hồ sơ chuyên gia. Ở chi tiết bài, nó chỉ có giá trị khi người đọc đã mở khoá bài đó (`ai_summary_unlocked: true`). `has_ai_summary` cho biết bài có bản tóm tắt để vẽ thẻ AI hay không.
- `POST /articles/:id/ai-summary` trả `{ article_id, ai_summary, charged, usage }`. Mỗi bài chỉ trừ lượt một lần; mở lại bài đã mở thì `charged: false` và không cần còn lượt. Bài không có bản tóm tắt thì `400`.
- Hết lượt thì `400` với `code: "NEWS_AI_SUMMARY_LIMIT_REACHED"` kèm `used`, `limit`, `peer_owned`, `reset_at`.
- `usage` (và `GET /me/ai-summary-usage`) có dạng giống quota chat AI: `used`, `limit`, `remaining`, `can_use`, `period: "monthly"`, `timezone`, `reset_at`, `base_limit`, `peer_owned`, `peer_bonus_per_item`, `peer_bonus_limit`. Tháng tính từ 00:00 ngày 1 giờ Việt Nam. Hạn mức = `NEWS_AI_SUMMARY_MONTHLY_LIMIT` (mặc định 10) + số Peer đang sở hữu × `NEWS_AI_SUMMARY_LIMIT_PER_PEER` (mặc định 5).

## API quản trị

Tất cả yêu cầu access token của tài khoản `ADMIN`.

| Method | Endpoint |
|---|---|
| GET/POST | `/api/v1/admin/news/articles` |
| PATCH | `/api/v1/admin/news/articles/:id` |
| POST | `/api/v1/admin/news/articles/:id/editorialize` |
| GET/POST | `/api/v1/admin/news/topics` |
| PATCH | `/api/v1/admin/news/topics/:id` |
| GET/POST | `/api/v1/admin/news/experts` |
| PATCH | `/api/v1/admin/news/experts/:id` |
| GET | `/api/v1/admin/news/sources` |
| PATCH | `/api/v1/admin/news/sources/:id` |
| POST | `/api/v1/admin/news/sources/:id/crawl` |
| POST | `/api/v1/admin/news/sources/crawl-all` |

`content_type` nhận `ARTICLE` hoặc `WAVE`. Nội dung `WAVE` bắt buộc có `video_url`. Trạng thái gồm `DRAFT`, `PUBLISHED`, `HIDDEN`; lần đầu chuyển sang `PUBLISHED`, hệ thống tự ghi nhận `published_at`.

## Crawl HTML và biên tập tiếng Việt bằng AI

Crawler chạy nền mỗi 5 phút và chỉ xử lý nguồn đã đến chu kỳ cấu hình. Danh sách hiện có: Investing.com, Forex Factory, CME Group, ICE, Yahoo Finance, Federal Reserve, ECB, IMF, World Bank và OPEC.

- Chỉ truy cập HTTPS trên đúng tên miền đã duyệt, tuân thủ `robots.txt`, giới hạn phản hồi HTML 3 MB và timeout 20 giây.
- Không vượt đăng nhập, paywall hay cơ chế chống bot. Lỗi HTTP/robots/selector được lưu vào nguồn và lần chạy để Admin theo dõi.
- Chống trùng bằng hash URL chuẩn hóa theo từng nguồn.
- Bài mới luôn được lưu ở trạng thái `DRAFT`.
- Tiêu đề và toàn bộ thân bài gốc nằm trong `source_title` và `source_content`; chỉ API Admin trả về. API ứng dụng không trả các trường này.
- Crawler không tự gọi AI. Sau khi bài gốc xuất hiện trong Admin, quản trị viên chọn “Dịch & biên tập bằng AI” và xác nhận việc sử dụng API credit.
- `POST /api/v1/admin/news/articles/:id/editorialize` nhận `{ "force": false }`. Gửi `force: true` khi Admin xác nhận biên tập lại và ghi đè bản tiếng Việt đã có.
- Mỗi lần biên tập tạo đồng bộ tiêu đề tiếng Việt, mô tả ngắn, tổng hợp 4–5 dòng (`ai_summary`) và bài viết đầy đủ (`content`).
- AI cũng chọn lĩnh vực của bài trong các lĩnh vực đang bật. Chỉ bài **chưa có** lĩnh vực mới được gán; lĩnh vực admin đã chọn (hoặc lấy từ nguồn) không bị đè khi biên tập lại. Không lĩnh vực nào hợp thì để trống.
- `content` là nội dung tiếng Việt hiển thị trên site sau khi Admin duyệt và xuất bản. Bản AI mới luôn ở trạng thái `DRAFT` và Admin có thể chỉnh sửa trước khi đăng.
- AI được yêu cầu giữ nguyên dữ kiện, tên riêng, số liệu và mốc thời gian; không dịch từng câu, không sao chép cách diễn đạt, không thêm dữ kiện hoặc lời khuyên tài chính.
- Trạng thái AI gồm `NOT_REQUESTED`, `PROCESSING`, `READY`, `FAILED`; API Admin trả thêm lỗi, model, thời điểm xử lý và số token input/output/total.
- Queue chỉ xử lý một job cùng lúc để tránh gọi AI dồn dập. Yêu cầu trùng khi bài đang `PROCESSING` sẽ bị từ chối.
- Nếu AI tạm lỗi hoặc tài khoản hết credit, bài gốc vẫn nguyên vẹn, trạng thái chuyển sang `FAILED` và Admin có thể thử lại sau.
- Biên tập lại luôn cần xác nhận vì sẽ ghi đè tiêu đề, mô tả và nội dung tiếng Việt đã có, đồng thời phát sinh thêm token.

Đặt `NEWS_CRAWL_ENABLED=false` nếu cần tạm dừng lịch tự động. Nút “Crawl ngay” vẫn xếp job thủ công vào Redis.

Để bật biên tập AI trên production, đặt `AI_MOCK=false`, cấu hình `GEMINI_API_KEY` và có thể thêm `DEEPSEEK_API_KEY` làm dự phòng. `NEWS_AI_SUMMARY_MODEL` chọn model Gemini cho biên tập; `NEWS_AI_EDITORIAL_MAX_TOKENS` điều chỉnh độ dài đầu ra, mặc định `3000`. Hệ thống chỉ dùng key sau thao tác xác nhận của Admin.
