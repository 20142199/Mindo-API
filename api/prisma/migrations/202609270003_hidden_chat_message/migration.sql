-- Xoá tin nhắn "ở phía tôi".
--
-- Khác hẳn thu hồi (`ChatMessage.deletedAt`): thu hồi gỡ tin khỏi mắt MỌI
-- người và chỉ tác giả làm được. Bảng này ghi lại việc một người không muốn
-- thấy một tin nữa — người gửi và các thành viên khác vẫn thấy nguyên, và
-- chính vì vậy nó phải nằm ở bảng riêng theo từng người chứ không phải một
-- cột trên tin.
CREATE TABLE "HiddenChatMessage" (
  "userId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "HiddenChatMessage_pkey" PRIMARY KEY ("userId", "messageId")
);

CREATE INDEX "HiddenChatMessage_userId_createdAt_idx" ON "HiddenChatMessage"("userId", "createdAt");

ALTER TABLE "HiddenChatMessage" ADD CONSTRAINT "HiddenChatMessage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HiddenChatMessage" ADD CONSTRAINT "HiddenChatMessage_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
