-- Email verification state and OTP abuse tracking
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "VerificationCode" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

-- Private KYC file metadata
CREATE TABLE "FileUpload" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FileUpload_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FileUpload_storedName_key" ON "FileUpload"("storedName");
CREATE INDEX "FileUpload_ownerId_createdAt_idx" ON "FileUpload"("ownerId", "createdAt");
ALTER TABLE "FileUpload" ADD CONSTRAINT "FileUpload_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- VietQR request/callback reconciliation fields
ALTER TABLE "Deposit"
    ADD COLUMN "vietQrOrderId" TEXT,
    ADD COLUMN "qrCodeUrl" TEXT,
    ADD COLUMN "vietQrData" JSONB,
    ADD COLUMN "bankTransactionId" TEXT,
    ADD COLUMN "bankReferenceNumber" TEXT,
    ADD COLUMN "paidAmountVnd" DECIMAL(20,0),
    ADD COLUMN "paidAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Deposit_vietQrOrderId_key" ON "Deposit"("vietQrOrderId");
CREATE UNIQUE INDEX "Deposit_bankTransactionId_key" ON "Deposit"("bankTransactionId");

-- Webhook-driven audit entries do not have a human actor
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_actorId_fkey";
ALTER TABLE "AuditLog" ALTER COLUMN "actorId" DROP NOT NULL;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
