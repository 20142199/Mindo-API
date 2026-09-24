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

## Crawl HTML làm nguồn tham khảo

Crawler chạy nền mỗi 5 phút và chỉ xử lý nguồn đã đến chu kỳ cấu hình. Danh sách hiện có: Investing.com, Forex Factory, CME Group, ICE, Yahoo Finance, Federal Reserve, ECB, IMF, World Bank và OPEC.

- Chỉ truy cập HTTPS trên đúng tên miền đã duyệt, tuân thủ `robots.txt`, giới hạn phản hồi HTML 3 MB và timeout 20 giây.
- Không vượt đăng nhập, paywall hay cơ chế chống bot. Lỗi HTTP/robots/selector được lưu vào nguồn và lần chạy để Admin theo dõi.
- Chống trùng bằng hash URL chuẩn hóa theo từng nguồn.
- Bài mới luôn được lưu ở trạng thái `DRAFT`.
- Toàn bộ văn bản trích từ thân bài nằm trong `source_content`, chỉ API Admin trả về. API ứng dụng không trả trường này.
- Khi AI được cấu hình, crawler tự tổng hợp nội dung nguồn thành 4–5 câu tiếng Việt, lưu trong `ai_summary`; trường này được trả về ở cả API Admin và API ứng dụng.
- Nếu AI tạm lỗi hoặc chưa được cấu hình, bài nguồn vẫn được lưu. Lần crawl sau sẽ thử bổ sung `ai_summary` cho các bài còn thiếu và không bao giờ lưu nội dung mô phỏng.
- `content` là nội dung Mindo biên tập để xuất bản và được lưu tách biệt; crawler không ghi đè nội dung này.

Đặt `NEWS_CRAWL_ENABLED=false` nếu cần tạm dừng lịch tự động. Nút “Crawl ngay” vẫn xếp job thủ công vào Redis.

Để bật tổng hợp AI trên production, đặt `AI_MOCK=false`, cấu hình `AI_API_KEY`, và có thể chọn model riêng bằng `NEWS_AI_SUMMARY_MODEL`.
