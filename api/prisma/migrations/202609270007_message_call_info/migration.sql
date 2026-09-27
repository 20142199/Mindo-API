-- Nhật ký cuộc gọi hiện ngay trong hội thoại, như Messenger.
--
-- Mỗi cuộc gọi kết thúc sinh MỘT tin hệ thống trong hội thoại 1-1 giữa hai
-- người. `content` mang câu chữ để bản app cũ vẫn đọc được; `callInfo` mang
-- số liệu để app mới vẽ icon, tô đỏ cuộc nhỡ, và cho gọi lại.
--
-- Vì sao nằm trong DÒNG TIN chứ không chỉ ở màn Lịch sử cuộc gọi: người ta
-- nhớ "hôm qua gọi nhau xong thì nhắn gì", và một cuộc gọi biến mất khỏi
-- dòng thời gian làm đứt mạch câu chuyện.
ALTER TABLE "ChatMessage" ADD COLUMN "callInfo" JSONB;
