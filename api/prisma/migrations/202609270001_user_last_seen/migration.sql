-- Mốc "lần cuối online" phục vụ trạng thái hoạt động của cụm Nhắn tin.
-- Nullable: người chưa từng mở socket chat thì không có mốc nào, và app
-- hiểu null là "không biết" rồi bỏ trống chứ không bịa ra một con số.
ALTER TABLE "User" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
