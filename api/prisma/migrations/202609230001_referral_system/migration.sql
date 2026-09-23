CREATE TYPE "ReferralCommissionType" AS ENUM ('DIRECT', 'BRANCH');

CREATE TABLE "ReferralSetting" (
    "id" TEXT NOT NULL,
    "directRate" DECIMAL(5,4) NOT NULL DEFAULT 0.10,
    "branchRate" DECIMAL(5,4) NOT NULL DEFAULT 0.05,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReferralSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SystemReferralCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "claimedById" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SystemReferralCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReferralCommission" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "beneficiaryId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "type" "ReferralCommissionType" NOT NULL,
    "rate" DECIMAL(5,4) NOT NULL,
    "amountVnd" DECIMAL(20,0) NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'EARNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    CONSTRAINT "ReferralCommission_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "LedgerEntry" ADD COLUMN "referralCommissionId" TEXT;

CREATE UNIQUE INDEX "SystemReferralCode_code_key" ON "SystemReferralCode"("code");
CREATE UNIQUE INDEX "SystemReferralCode_claimedById_key" ON "SystemReferralCode"("claimedById");
CREATE INDEX "SystemReferralCode_isActive_createdAt_idx" ON "SystemReferralCode"("isActive", "createdAt");
CREATE UNIQUE INDEX "ReferralCommission_orderId_beneficiaryId_type_key" ON "ReferralCommission"("orderId", "beneficiaryId", "type");
CREATE INDEX "ReferralCommission_beneficiaryId_type_createdAt_idx" ON "ReferralCommission"("beneficiaryId", "type", "createdAt");
CREATE INDEX "ReferralCommission_buyerId_createdAt_idx" ON "ReferralCommission"("buyerId", "createdAt");
CREATE UNIQUE INDEX "LedgerEntry_referralCommissionId_key" ON "LedgerEntry"("referralCommissionId");

ALTER TABLE "ReferralSetting" ADD CONSTRAINT "ReferralSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SystemReferralCode" ADD CONSTRAINT "SystemReferralCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SystemReferralCode" ADD CONSTRAINT "SystemReferralCode_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReferralCommission" ADD CONSTRAINT "ReferralCommission_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferralCommission" ADD CONSTRAINT "ReferralCommission_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralCommission" ADD CONSTRAINT "ReferralCommission_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_referralCommissionId_fkey" FOREIGN KEY ("referralCommissionId") REFERENCES "ReferralCommission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "ReferralSetting" ("id", "directRate", "branchRate", "updatedAt")
VALUES ('default', 0.10, 0.05, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
