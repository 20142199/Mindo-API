# Mindo News API

Tính năng tin tức bám theo flow Figma gồm Tường, Khám phá, Tìm kiếm, Bài viết, Hồ sơ chuyên gia, Cá nhân và Sóng.

## API cho ứng dụng

Các API đọc chấp nhận access token nhưng không bắt buộc; khi có token, response có thêm trạng thái `is_following`, `is_liked` và tự loại nội dung người dùng không quan tâm.

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | `/api/v1/news/home` | Tường: chuyên gia đề xuất, bài viết, Sóng |
| GET | `/api/v1/news/articles` | Danh sách; hỗ trợ `q`, `topic`, `expert`, `type`, `page`, `limit` |
| GET | `/api/v1/news/articles/:idOrSlug` | Chi tiết bài viết/Sóng |
| GET | `/api/v1/news/search?q=...` | Tìm đồng thời bài viết và chuyên gia |
| GET | `/api/v1/news/topics` | Danh sách lĩnh vực |
| GET | `/api/v1/news/experts` | Khám phá chuyên gia |
| GET | `/api/v1/news/experts/:idOrSlug` | Hồ sơ và bài đăng của chuyên gia |
| POST/DELETE | `/api/v1/news/experts/:id/follow` | Theo dõi/bỏ theo dõi |
| GET | `/api/v1/news/me` | Hồ sơ tin tức cá nhân |
| PATCH | `/api/v1/news/me/interests` | Chọn lĩnh vực quan tâm với `{ "topic_ids": [] }` |
| POST/DELETE | `/api/v1/news/articles/:id/like` | Thích/bỏ thích |
| POST | `/api/v1/news/articles/:id/feedback` | `NOT_INTERESTED`, `HIDE_TOPIC`, `REPORT` |

## API quản trị

Tất cả yêu cầu access token của tài khoản `ADMIN`.

| Method | Endpoint |
|---|---|
| GET/POST | `/api/v1/admin/news/articles` |
| PATCH | `/api/v1/admin/news/articles/:id` |
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
- Khi AI được cấu hình, một lần biên tập tạo đồng bộ tiêu đề tiếng Việt, mô tả ngắn, tổng hợp 4–5 dòng (`ai_summary`) và bài viết đầy đủ (`content`).
- `content` là nội dung tiếng Việt hiển thị trên site sau khi Admin duyệt và xuất bản. Bản AI mới luôn ở trạng thái `DRAFT` và Admin có thể chỉnh sửa trước khi đăng.
- AI được yêu cầu giữ nguyên dữ kiện, tên riêng, số liệu và mốc thời gian; không dịch từng câu, không sao chép cách diễn đạt, không thêm dữ kiện hoặc lời khuyên tài chính.
- Nếu AI tạm lỗi hoặc chưa được cấu hình, bài gốc vẫn được lưu. Lần crawl sau sẽ thử bổ sung bản biên tập cho các bài còn thiếu và không bao giờ lưu nội dung mô phỏng.
- Crawler không ghi đè `content` đã có, nhờ đó nội dung Admin đã chỉnh sửa được giữ nguyên; nếu chỉ thiếu `ai_summary`, hệ thống chỉ bổ sung trường này.

Đặt `NEWS_CRAWL_ENABLED=false` nếu cần tạm dừng lịch tự động. Nút “Crawl ngay” vẫn xếp job thủ công vào Redis.

Để bật biên tập AI trên production, đặt `AI_MOCK=false`, cấu hình `AI_API_KEY`, và có thể chọn model riêng bằng `NEWS_AI_SUMMARY_MODEL`. `NEWS_AI_EDITORIAL_MAX_TOKENS` điều chỉnh độ dài đầu ra, mặc định `3000`.
