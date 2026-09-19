CREATE TYPE "CallType" AS ENUM ('AUDIO', 'VIDEO');
CREATE TYPE "CallStatus" AS ENUM ('RINGING', 'ACCEPTED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'MISSED', 'FAILED');

CREATE TABLE "Call" (
  "id" TEXT NOT NULL,
  "channelName" TEXT NOT NULL,
  "conversationId" TEXT,
  "callerId" TEXT NOT NULL,
  "calleeId" TEXT NOT NULL,
  "callType" "CallType" NOT NULL,
  "status" "CallStatus" NOT NULL DEFAULT 'RINGING',
  "endReason" TEXT,
  "ringingAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "durationSec" INTEGER NOT NULL DEFAULT 0,
  "callerClient" TEXT,
  "calleeClient" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Call_channelName_key" ON "Call"("channelName");
CREATE INDEX "Call_callerId_status_idx" ON "Call"("callerId", "status");
CREATE INDEX "Call_calleeId_status_idx" ON "Call"("calleeId", "status");
CREATE INDEX "Call_createdAt_idx" ON "Call"("createdAt");
CREATE INDEX "Call_conversationId_createdAt_idx" ON "Call"("conversationId", "createdAt");

ALTER TABLE "Call" ADD CONSTRAINT "Call_callerId_fkey"
  FOREIGN KEY ("callerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Call" ADD CONSTRAINT "Call_calleeId_fkey"
  FOREIGN KEY ("calleeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
