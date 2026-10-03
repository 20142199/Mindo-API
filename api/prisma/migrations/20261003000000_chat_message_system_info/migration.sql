-- Tin hệ thống của nhóm mang thêm dữ liệu có cấu trúc: ai làm, làm gì, với ai.
--
-- `content` là MỘT câu dựng sẵn ở server ("Nguyen Hong Son đã tạo nhóm"), mà
-- `message:new` phát một payload cho cả phòng — nên người tạo nhóm đọc thấy tên
-- chính mình thay cho "Bạn", và tên gợi nhớ đặt cho bạn bè không bao giờ hiện.
-- Cột này cho app tự dựng câu theo người đang xem; `content` vẫn ghi y như cũ
-- để app bản cũ đọc được. Tin cũ để null, app rơi về `content`.
ALTER TABLE "ChatMessage" ADD COLUMN "systemInfo" JSONB;
