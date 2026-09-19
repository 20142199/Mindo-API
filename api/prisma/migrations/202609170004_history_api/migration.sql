ALTER TABLE "Deposit"
  ADD COLUMN "balanceBeforeVnd" DECIMAL(20, 0),
  ADD COLUMN "balanceAfterVnd" DECIMAL(20, 0);

CREATE INDEX "Deposit_userId_createdAt_idx" ON "Deposit"("userId", "createdAt");
