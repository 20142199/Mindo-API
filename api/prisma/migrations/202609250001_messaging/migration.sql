CREATE TYPE "ConversationType" AS ENUM ('DIRECT', 'GROUP');
CREATE TYPE "ConversationMemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
CREATE TYPE "ChatMessageType" AS ENUM ('TEXT', 'IMAGE', 'FILE', 'SYSTEM');

CREATE TABLE "Conversation" (
  "id" TEXT NOT NULL,
  "type" "ConversationType" NOT NULL,
  "directKey" TEXT,
  "title" TEXT,
  "avatarFileId" TEXT,
  "createdById" TEXT NOT NULL,
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversationMember" (
  "conversationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "ConversationMemberRole" NOT NULL DEFAULT 'MEMBER',
  "isMuted" BOOLEAN NOT NULL DEFAULT false,
  "isHidden" BOOLEAN NOT NULL DEFAULT false,
  "lastReadMessageId" TEXT,
  "lastReadAt" TIMESTAMP(3),
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" TIMESTAMP(3),
  CONSTRAINT "ConversationMember_pkey" PRIMARY KEY ("conversationId", "userId")
);

CREATE TABLE "ChatMessage" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "senderId" TEXT,
  "type" "ChatMessageType" NOT NULL DEFAULT 'TEXT',
  "content" TEXT,
  "attachments" JSONB,
  "clientMessageId" TEXT,
  "replyToId" TEXT,
  "quotedMessageSnapshot" JSONB,
  "editedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SavedChatMessage" (
  "userId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SavedChatMessage_pkey" PRIMARY KEY ("userId", "messageId")
);

CREATE UNIQUE INDEX "Conversation_directKey_key" ON "Conversation"("directKey");
CREATE INDEX "Conversation_lastMessageAt_idx" ON "Conversation"("lastMessageAt");
CREATE INDEX "Conversation_createdById_createdAt_idx" ON "Conversation"("createdById", "createdAt");
CREATE INDEX "ConversationMember_userId_isHidden_leftAt_idx" ON "ConversationMember"("userId", "isHidden", "leftAt");
CREATE UNIQUE INDEX "ChatMessage_conversationId_clientMessageId_key" ON "ChatMessage"("conversationId", "clientMessageId");
CREATE INDEX "ChatMessage_conversationId_createdAt_id_idx" ON "ChatMessage"("conversationId", "createdAt", "id");
CREATE INDEX "ChatMessage_senderId_createdAt_idx" ON "ChatMessage"("senderId", "createdAt");
CREATE INDEX "ChatMessage_replyToId_idx" ON "ChatMessage"("replyToId");
CREATE INDEX "SavedChatMessage_userId_createdAt_idx" ON "SavedChatMessage"("userId", "createdAt");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_senderId_fkey"
  FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_replyToId_fkey"
  FOREIGN KEY ("replyToId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SavedChatMessage" ADD CONSTRAINT "SavedChatMessage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedChatMessage" ADD CONSTRAINT "SavedChatMessage_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
