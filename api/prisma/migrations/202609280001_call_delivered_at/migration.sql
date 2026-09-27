-- "Đang gọi…" -> "Đang đổ chuông…" như Messenger.
--
-- Máy người nhận gọi POST /calls/:id/ringing khi thấy cuộc gọi đến; mốc này
-- cho người gọi biết cuộc gọi đã thật sự tới máy bên kia. NULL = chưa tới
-- (hoặc cuộc gọi tạo trước khi có cột này).
ALTER TABLE "Call" ADD COLUMN "deliveredAt" TIMESTAMP(3);
