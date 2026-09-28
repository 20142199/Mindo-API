CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "Withdrawal" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "amountVnd" DECIMAL(20,0) NOT NULL,
  "bankName" TEXT NOT NULL,
  "bankAccountNumber" TEXT NOT NULL,
  "bankAccountName" TEXT NOT NULL,
  "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" TEXT NOT NULL,
  "balanceBeforeVnd" DECIMAL(20,0) NOT NULL,
  "balanceAfterVnd" DECIMAL(20,0) NOT NULL,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "rejectionReason" TEXT,
  "transferProofFileId" TEXT,
  "bankTransactionCode" TEXT,
  "refundedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Withdrawal_amountVnd_positive" CHECK ("amountVnd" > 0),
  CONSTRAINT "Withdrawal_balance_snapshot_nonnegative" CHECK ("balanceBeforeVnd" >= 0 AND "balanceAfterVnd" >= 0)
);

ALTER TABLE "LedgerEntry" ADD COLUMN "withdrawalId" TEXT;

CREATE UNIQUE INDEX "Withdrawal_bankTransactionCode_key" ON "Withdrawal"("bankTransactionCode");
CREATE UNIQUE INDEX "Withdrawal_userId_idempotencyKey_key" ON "Withdrawal"("userId", "idempotencyKey");
CREATE INDEX "Withdrawal_status_createdAt_idx" ON "Withdrawal"("status", "createdAt");
CREATE INDEX "Withdrawal_userId_createdAt_idx" ON "Withdrawal"("userId", "createdAt");
CREATE INDEX "LedgerEntry_withdrawalId_createdAt_idx" ON "LedgerEntry"("withdrawalId", "createdAt");

ALTER TABLE "Withdrawal"
ADD CONSTRAINT "Withdrawal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "Withdrawal_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LedgerEntry"
ADD CONSTRAINT "LedgerEntry_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "Withdrawal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "User"
ADD CONSTRAINT "User_balanceVnd_nonnegative" CHECK ("balanceVnd" >= 0);
